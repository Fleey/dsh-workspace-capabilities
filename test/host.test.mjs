import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcpServerOf, normalizePath, normalizeState, skillOriginOf, skillRow, toolOrigin } from '../lib/index.js'

test('mcpServerOf splits mcp__<server>__<tool>', () => {
  assert.equal(mcpServerOf('mcp__github__create_issue'), 'github')
  assert.equal(mcpServerOf('mcp__my-server__do__thing'), 'my-server')
  assert.equal(mcpServerOf('read_file'), undefined)
  assert.equal(mcpServerOf('mcp__broken'), undefined)
  assert.equal(mcpServerOf(undefined), undefined)
})

test('normalizePath drops trailing separators only', () => {
  assert.equal(normalizePath('/a/b/'), '/a/b')
  assert.equal(normalizePath('/a/b'), '/a/b')
  assert.equal(normalizePath('C:\\x\\'), 'C:\\x')
  assert.equal(normalizePath('/'), '/')
  assert.equal(normalizePath(undefined), '')
})

test('normalizeState dedupes, sorts and drops empty or malformed entries', () => {
  const state = normalizeState({
    workspaces: {
      '/w1/': { disabledSkills: ['b', 'a', 'a', '', 3], disabledMcpServers: ['x'] },
      '/w2': { disabledSkills: [], disabledMcpServers: [] },
      '/w3': 'nope',
    },
  })
  assert.deepEqual(state, {
    version: 1,
    workspaces: { '/w1': { disabledSkills: ['a', 'b'], disabledMcpServers: ['x'], disabledTools: [] } },
  })
  assert.deepEqual(normalizeState(null), { version: 1, workspaces: {} })
})

test('normalizeState keeps an entry that only disables tools', () => {
  const state = normalizeState({ workspaces: { '/w': { disabledTools: ['workflow', 'workflow', ''] } } })
  assert.deepEqual(state, {
    version: 1,
    workspaces: { '/w': { disabledSkills: [], disabledMcpServers: [], disabledTools: ['workflow'] } },
  })
})

test('skillRow carries the candidate invocation policy', () => {
  const provider = { name: 'dsh-skills-manager-external' }
  const off = skillRow({ candidate: { name: 'a', description: 'd', invocation: { modelInvocable: false, userInvocable: false } }, provider })
  assert.deepEqual(off, { name: 'a', description: 'd', provider: 'dsh-skills-manager-external', modelInvocable: false, userInvocable: false })
  const plain = skillRow({ candidate: { name: 'b' }, provider: undefined })
  assert.deepEqual(plain, { name: 'b', description: '', provider: '', modelInvocable: true, userInvocable: true })
})

test('toolOrigin splits harness tools from plugin tools', () => {
  assert.equal(toolOrigin('pwsh'), 'system')
  assert.equal(toolOrigin('workflow'), 'system')
  assert.equal(toolOrigin('cordis_inspect_query'), 'system')
  assert.equal(toolOrigin('session_bridge_send'), 'plugin')
  assert.equal(toolOrigin('web_search_enhanced'), 'plugin')
})

test('skillOriginOf reads the shipping path, not the source label', () => {
  const preset = 'C:\\x\\node_modules\\@deepseek-ai\\dsh-agent-preset\\skills\\agent-experience\\SKILL.md'
  const official = '/x/official-skills/office/SKILL.md'
  // A third-party plugin's skill lives under its own package and reports
  // `source: 'bundled'` too, so only the path can tell them apart.
  const plugin = 'C:\\x\\node_modules\\archify\\skills\\archify\\SKILL.md'
  assert.equal(skillOriginOf(preset), 'system')
  assert.equal(skillOriginOf(official), 'system')
  assert.equal(skillOriginOf(plugin), 'plugin')
  assert.equal(skillOriginOf(undefined), 'plugin')
})
