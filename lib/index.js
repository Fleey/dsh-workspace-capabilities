/**
 * dsh-workspace-capabilities — host half.
 *
 * Lets each workspace choose which skills and MCP servers its sessions see.
 * Selections are a per-workspace deny list keyed by the workspace path (the
 * same canonical cwd every member session's header carries), stored in
 * $DSH_HOME/workspace-capabilities.json:
 *
 *   { "version": 1, "workspaces": { "<path>": { "disabledSkills": [..], "disabledMcpServers": [..] } } }
 *
 * New skills and servers are therefore enabled by default.
 *
 *   - Skills: the skill registry has no filter hook, so the registry's
 *     `collectFresh` is wrapped to drop the disabled names for the lookup's
 *     `cwd`. Every consumer (session catalog, `skill` tool, `/name` gestures)
 *     reads through it, and the registry cache is already keyed by cwd.
 *   - MCP: every live agent gets `agent.ctx.tools.restrict({ deny })` over the
 *     `mcp__<server>__*` tools of its workspace's disabled servers, re-derived
 *     whenever the tool set or the selection changes.
 *
 * Routes (same auth gate as the host's own API):
 *   GET  /dsh-workspace-capabilities/state?workspaceId=<id>
 *   POST /dsh-workspace-capabilities/save   { workspaceId, disabledSkills, disabledMcpServers }
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-workspace-capabilities'
export const inject = ['tools', 'skills', 'agents', 'webServer']

export const ROUTE_PREFIX = '/dsh-workspace-capabilities'
const ORIGINAL = Symbol.for('cordis.original')
const MCP_PREFIX = 'mcp__'
const MAX_BODY_BYTES = 1 << 20

export function statePath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'workspace-capabilities.json')
}

/** Trailing separators never distinguish two workspaces. */
export function normalizePath(path) {
  if (typeof path !== 'string') return ''
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  return trimmed === '' && path.trim() !== '' ? path.trim().slice(0, 1) : trimmed
}

/** `mcp__<server>__<tool>` → `<server>`, or undefined for any other tool. */
export function mcpServerOf(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith(MCP_PREFIX)) return undefined
  const rest = toolName.slice(MCP_PREFIX.length)
  const at = rest.indexOf('__')
  return at > 0 ? rest.slice(0, at) : undefined
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))].sort()
}

/** Validate a stored or submitted document; anything malformed reads as empty. */
export function normalizeState(raw) {
  const workspaces = {}
  const source = raw && typeof raw === 'object' && raw.workspaces && typeof raw.workspaces === 'object' ? raw.workspaces : {}
  for (const [path, entry] of Object.entries(source)) {
    const key = normalizePath(path)
    if (!key || !entry || typeof entry !== 'object') continue
    const disabledSkills = uniqueStrings(entry.disabledSkills)
    const disabledMcpServers = uniqueStrings(entry.disabledMcpServers)
    if (disabledSkills.length === 0 && disabledMcpServers.length === 0) continue
    workspaces[key] = { disabledSkills, disabledMcpServers }
  }
  return { version: 1, workspaces }
}

class Store {
  constructor(file) {
    this.file = file
    this.state = { version: 1, workspaces: {} }
    this.queue = Promise.resolve()
    try {
      this.state = normalizeState(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      if (error?.code !== 'ENOENT') this.loadError = error
    }
  }

  get(path) {
    return this.state.workspaces[normalizePath(path)]
  }

  /** Replace one workspace's selection; writes are serialized and atomic. */
  set(path, selection) {
    const key = normalizePath(path)
    const next = normalizeState({ workspaces: { ...this.state.workspaces, [key]: selection } })
    if (!next.workspaces[key]) delete next.workspaces[key]
    this.state = next
    const text = `${JSON.stringify(next, null, 2)}\n`
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, this.file)
    }
    this.queue = this.queue.then(write, write)
    return this.queue
  }
}

export function apply(ctx) {
  const store = new Store(statePath())
  if (store.loadError) ctx.logger.warn('cannot read %s, starting empty: %s', store.file, store.loadError)

  const disabledSkillsFor = (cwd) => {
    const entry = cwd === undefined ? undefined : store.get(cwd)
    return entry && entry.disabledSkills.length > 0 ? new Set(entry.disabledSkills) : undefined
  }
  const disabledServersFor = (cwd) => {
    const entry = cwd === undefined ? undefined : store.get(cwd)
    return entry && entry.disabledMcpServers.length > 0 ? new Set(entry.disabledMcpServers) : undefined
  }

  // ---- skills -------------------------------------------------------------

  const skills = ctx.skills[ORIGINAL] ?? ctx.skills
  /** The unfiltered collector, for the selector's own listing. */
  let collectAll
  const invalidateSkills = () => {
    try {
      skills.invalidateCache?.()
    } catch (error) {
      ctx.logger.warn('skill catalog invalidation failed: %s', error)
    }
  }
  ctx.effect(() => {
    const own = Object.prototype.hasOwnProperty.call(skills, 'collectFresh')
    const previous = skills.collectFresh
    if (typeof previous !== 'function') {
      ctx.logger.warn('skill registry has no collectFresh(); per-workspace skill selection is unavailable')
      return () => {}
    }
    collectAll = (options) => previous.call(skills, options)
    skills.collectFresh = async function collectFresh(options) {
      const result = await previous.call(this, options)
      const disabled = disabledSkillsFor(options?.cwd)
      if (disabled === undefined) return result
      const entries = new Map(result.entries)
      for (const skill of disabled) entries.delete(skill)
      return { ...result, entries }
    }
    invalidateSkills()
    return () => {
      if (own) skills.collectFresh = previous
      else delete skills.collectFresh
      collectAll = undefined
      invalidateSkills()
    }
  }, 'workspace-capabilities: skill filter')

  // ---- MCP ----------------------------------------------------------------

  /** agent id → { agent, key, dispose } */
  const restrictions = new Map()

  const liveAgents = () => {
    try {
      return [...(ctx.agents.list?.() ?? [])]
    } catch {
      return []
    }
  }
  const cwdOf = (agent) => agent?.session?.header?.cwd

  const denyFor = (agent) => {
    const servers = disabledServersFor(cwdOf(agent))
    if (servers === undefined) return []
    const known = ctx.tools.view(agent).restrictableNames
    return [...known].filter((tool) => servers.has(mcpServerOf(tool))).sort()
  }

  const lift = (entry) => {
    const dispose = entry?.dispose
    if (entry) entry.dispose = undefined
    if (typeof dispose === 'function') {
      try {
        dispose()
      } catch (error) {
        ctx.logger.warn('lifting MCP restriction failed: %s', error)
      }
    }
  }

  const reconcileAgent = (agent) => {
    if (!agent || agent.id === undefined) return
    let deny
    try {
      deny = denyFor(agent)
    } catch (error) {
      ctx.logger.warn('agent "%s": cannot resolve MCP tools: %s', agent.id, error)
      return
    }
    const key = deny.join('\n')
    const current = restrictions.get(agent.id)
    if (current && current.agent === agent && current.key === key) return
    // Record the target before touching the registry: both the lift and the
    // new restriction emit `tools/change`, which re-enters this function and
    // must see the work as already done.
    const entry = { agent, key, dispose: undefined }
    restrictions.set(agent.id, entry)
    if (current && current.agent === agent) lift(current)
    if (deny.length === 0) return
    try {
      const tools = agent.ctx?.get?.('tools') ?? agent.ctx?.tools
      entry.dispose = tools.restrict({ deny })
    } catch (error) {
      ctx.logger.warn('agent "%s": cannot restrict MCP tools: %s', agent.id, error)
    }
  }

  let reconciling = false
  let again = false
  const reconcileAll = () => {
    if (reconciling) {
      again = true
      return
    }
    reconciling = true
    try {
      do {
        again = false
        const live = liveAgents()
        const ids = new Set(live.map((agent) => agent.id))
        for (const [id, entry] of restrictions) {
          if (!ids.has(id)) restrictions.delete(id)
          else if (entry.agent !== live.find((agent) => agent.id === id)) restrictions.delete(id)
        }
        for (const agent of live) reconcileAgent(agent)
      } while (again)
    } finally {
      reconciling = false
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    reconcileAgent(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    // The restriction is an effect on the agent's own context and is
    // released with it; only forget it here.
    if (restrictions.get(agent?.id)?.agent === agent) restrictions.delete(agent.id)
  })
  ctx.on('tools/change', () => {
    reconcileAll()
  })
  ctx.effect(() => {
    reconcileAll()
    return () => {
      for (const entry of restrictions.values()) lift(entry)
      restrictions.clear()
    }
  }, 'workspace-capabilities: MCP restrictions')

  // ---- listing for the selector -------------------------------------------

  const workspaceRegistry = () => {
    try {
      return ctx.get('workspaceRegistry')
    } catch {
      return undefined
    }
  }

  /** A live agent to view layered registries through: prefer one in this workspace. */
  const viewingAgent = (path) => {
    const live = liveAgents()
    return live.find((agent) => normalizePath(cwdOf(agent)) === path) ?? live[0]
  }

  async function describe(workspace) {
    const path = normalizePath(workspace.path)
    const entry = store.get(path) ?? { disabledSkills: [], disabledMcpServers: [] }
    const scope = viewingAgent(path)

    let skillRows = []
    let skillsComplete = true
    if (collectAll) {
      const collected = await collectAll({ cwd: workspace.path, ...(scope ? { scope } : {}) })
      skillsComplete = collected.cacheable !== false
      for (const { candidate, provider } of collected.entries.values()) {
        skillRows.push({
          name: candidate.name,
          description: typeof candidate.description === 'string' ? candidate.description : '',
          provider: typeof provider?.name === 'string' ? provider.name : '',
        })
      }
    }
    const disabledSkills = new Set(entry.disabledSkills)
    // Keep disabled skills that are currently not discovered so they can be re-enabled.
    for (const missing of disabledSkills) {
      if (!skillRows.some((row) => row.name === missing)) skillRows.push({ name: missing, description: '', provider: '', missing: true })
    }
    skillRows = skillRows
      .map((row) => ({ ...row, enabled: !disabledSkills.has(row.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const servers = new Map()
    let known = []
    try {
      known = [...ctx.tools.view(scope).knownNames]
    } catch {
      known = ctx.tools.schemas().map((schema) => schema.name)
    }
    for (const tool of known) {
      const server = mcpServerOf(tool)
      if (server === undefined) continue
      if (!servers.has(server)) servers.set(server, [])
      servers.get(server).push(tool.slice(MCP_PREFIX.length + server.length + 2))
    }
    const disabledServers = new Set(entry.disabledMcpServers)
    for (const missing of disabledServers) if (!servers.has(missing)) servers.set(missing, null)
    const mcp = [...servers]
      .map(([server, tools]) => ({
        server,
        tools: tools ? tools.sort() : [],
        connected: tools !== null,
        enabled: !disabledServers.has(server),
      }))
      .sort((a, b) => a.server.localeCompare(b.server))

    return {
      workspace: { id: workspace.id, title: workspace.title ?? '', path: workspace.path },
      skills: skillRows,
      skillsComplete,
      mcp,
    }
  }

  // ---- routes -------------------------------------------------------------

  const refuse = (request, response) => {
    let status
    try {
      const connection = ctx.get('connection')
      status = connection?.requestRejection?.call(connection, request)
    } catch {
      status = 403
    }
    if (status === undefined) return false
    sendJson(response, status, { ok: false, error: status === 401 ? 'login required' : 'forbidden' })
    return true
  }

  const findWorkspace = (id) => {
    const registry = workspaceRegistry()
    if (!registry) return { error: 'workspace registry unavailable', status: 503 }
    const workspace = typeof id === 'string' && id ? registry.get(id) : undefined
    if (!workspace) return { error: `unknown workspace: ${id}`, status: 404 }
    return { workspace }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/state`,
    handler: async (request, response) => {
      if (refuse(request, response)) return
      if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: 'method not allowed' })
      const url = new URL(request.url ?? '', 'http://localhost')
      const found = findWorkspace(url.searchParams.get('workspaceId'))
      if (found.error) return sendJson(response, found.status, { ok: false, error: found.error })
      try {
        sendJson(response, 200, { ok: true, data: await describe(found.workspace) })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'workspace-capabilities: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/save`,
    handler: async (request, response) => {
      if (refuse(request, response)) return
      if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(request) || !String(request.headers['content-type'] ?? '').startsWith('application/json')) {
        return sendJson(response, 403, { ok: false, error: 'forbidden' })
      }
      let body
      try {
        body = JSON.parse(await readBody(request, MAX_BODY_BYTES))
      } catch {
        return sendJson(response, 400, { ok: false, error: 'invalid body' })
      }
      const found = findWorkspace(body?.workspaceId)
      if (found.error) return sendJson(response, found.status, { ok: false, error: found.error })
      try {
        await store.set(found.workspace.path, {
          disabledSkills: uniqueStrings(body.disabledSkills),
          disabledMcpServers: uniqueStrings(body.disabledMcpServers),
        })
        invalidateSkills()
        reconcileAll()
        try {
          ctx.emit('commands/change')
        } catch {}
        sendJson(response, 200, { ok: true, data: await describe(found.workspace) })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'workspace-capabilities: save route')
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

async function readBody(request, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
    return url.host === request.headers.host
  } catch {
    return false
  }
}
