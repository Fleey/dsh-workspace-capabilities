/**
 * dsh-workspace-capabilities — browser half.
 *
 * The sidebar's workspace "..." menu is a fixed two-row list (rename,
 * delete) with no slot, so this half extends it from the DOM: when that menu
 * opens for a workspace row (`[data-row-key="workspace:<id>"]`), a
 * "技能与 MCP" row cloned from the rename row is inserted after it. Choosing
 * it closes the menu and opens a dialog listing the workspace's skills and
 * MCP servers as checkboxes; saving posts the unchecked ones to the host
 * half (lib/index.js), which applies them to the workspace's sessions from
 * their next turn.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-capabilities',
  factory: (require) => {
    const React = require('react')
    const { createRoot } = require('react-dom/client')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useState, useEffect, useMemo, useSyncExternalStore } = React

    const PACKAGE = 'dsh-workspace-capabilities'
    const ROUTE = 'dsh-workspace-capabilities'
    const ROW_PREFIX = 'workspace:'
    /** A menu opened this long after a workspace-row button press belongs to that row. */
    const MENU_WINDOW_MS = 1500

    const zh = {
      menu: '技能与 MCP',
      title: '技能与 MCP · {name}',
      skills: '技能',
      mcp: 'MCP 服务器',
      search: '筛选…',
      all: '全选',
      none: '全不选',
      loading: '正在读取…',
      empty: '没有可用的技能',
      emptyMcp: '没有已连接的 MCP 服务器',
      missing: '当前未发现',
      disconnected: '未连接',
      tools: '{n} 个工具',
      partial: '部分技能来源未能读取，列表可能不完整。',
      blocked: '已在技能来源中停用（如技能管理器），这里勾选无效；请先在来源处启用。',
      blockedShort: '来源已停用',
      userOnly: '模型不可自动调用，仅可用 /{name} 手动加载',
      modelOnly: '不可用 /{name} 手动加载，仅模型可调用',
      hint: '取消勾选的技能和 MCP 服务器不会提供给该工作区的会话，从下一轮对话起生效。新出现的技能和服务器默认启用。',
      cancel: '取消',
      save: '保存',
      saving: '保存中…',
      close: '关闭',
      error: '出错了：{message}',
      count: '{on}/{total}',
    }
    const en = {
      menu: 'Skills & MCP',
      title: 'Skills & MCP · {name}',
      skills: 'Skills',
      mcp: 'MCP servers',
      search: 'Filter…',
      all: 'All',
      none: 'None',
      loading: 'Loading…',
      empty: 'No skills available',
      emptyMcp: 'No connected MCP servers',
      missing: 'not found',
      disconnected: 'disconnected',
      tools: '{n} tools',
      partial: 'Some skill sources could not be read; the list may be incomplete.',
      blocked: 'Disabled at its source (e.g. the skills manager); checking it here has no effect. Enable it there first.',
      blockedShort: 'disabled at source',
      userOnly: 'The model cannot invoke it; load it manually with /{name}',
      modelOnly: 'Cannot be loaded with /{name}; only the model can invoke it',
      hint: "Unchecked skills and MCP servers are hidden from this workspace's sessions from their next turn. New skills and servers are enabled by default.",
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      close: 'Close',
      error: 'Error: {message}',
      count: '{on}/{total}',
    }
    const t = (key, params) => {
      const lang = (document.documentElement.lang || navigator.language || 'zh').toLowerCase()
      const dict = lang.startsWith('zh') ? zh : en
      let text = dict[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value))
      return text
    }

    const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>'

    const CSS = `
.dwc-dialog{width:min(640px,calc(100vw - 48px))!important;max-width:none!important}
.dwc-body{display:flex;flex-direction:column;gap:16px;max-height:min(65vh,640px);overflow:auto;padding-right:4px}
.dwc-hint{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dwc-warn{font-size:13px;line-height:20px;color:var(--dsw-alias-state-warn-primary)}
.dwc-error{font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.dwc-section{display:flex;flex-direction:column;gap:4px}
.dwc-head{display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1);padding:4px 0}
.dwc-head-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dwc-head-count{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dwc-head-spacer{flex:1}
.dwc-link{border:none;background:none;padding:0 4px;font-size:12px;cursor:pointer;color:var(--dsw-alias-link,var(--dsw-alias-label-secondary))}
.dwc-link:hover{text-decoration:underline}
.dwc-body .dwc-search{box-sizing:border-box;width:100%;height:32px;min-height:32px;line-height:30px;padding:0 10px;appearance:none;-webkit-appearance:none;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
.dwc-body .dwc-search:focus{border-color:var(--dsw-focus-ring-color)}
.dwc-row{display:flex;align-items:flex-start;gap:10px;padding:6px 8px;border-radius:var(--dsw-radius-md);cursor:pointer}
.dwc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwc-row input{margin:3px 0 0;flex:none;width:14px;height:14px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,var(--dsw-static-deepseek-500))}
.dwc-row-main{min-width:0;flex:1}
.dwc-row-name{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dwc-row-meta{display:inline-block;margin-left:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;word-break:normal}
.dwc-row-desc{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.dwc-row.dwc-off .dwc-row-name{color:var(--dsw-alias-label-tertiary)}
.dwc-row.dwc-blocked{cursor:default;opacity:.6}
.dwc-row.dwc-blocked input{cursor:default}
.dwc-row-note{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
.dwc-empty{font-size:13px;color:var(--dsw-alias-label-tertiary);padding:6px 8px}
.dwc-footer{display:flex;justify-content:flex-end;gap:8px}
`

    function api(path) {
      const url = new URL(`${ROUTE}/${path}`, document.baseURI)
      return url.pathname + url.search
    }

    async function request(path, init) {
      const response = await fetch(api(path), { cache: 'no-store', credentials: 'same-origin', ...init })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || !payload || payload.ok !== true) throw new Error(payload?.error || `HTTP ${response.status}`)
      return payload.data
    }

    /** The one open-dialog request, shared by the DOM hook and the React tree. */
    function createStore() {
      let value = null
      const listeners = new Set()
      return {
        get: () => value,
        set: (next) => {
          value = next
          for (const listener of listeners) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    function matches(query, ...fields) {
      if (!query) return true
      const q = query.toLowerCase()
      return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(q))
    }

    /** Both invocation paths are off at the skill's source: our selection cannot turn it on. */
    const isBlocked = (row) => row.modelInvocable === false && row.userInvocable === false

    function skillNote(row) {
      if (isBlocked(row)) return t('blocked')
      if (row.modelInvocable === false) return t('userOnly', { name: row.name })
      if (row.userInvocable === false) return t('modelOnly', { name: row.name })
      return null
    }

    function Row({ checked, onChange, name, meta, description, note, disabled }) {
      return h('label', { className: `dwc-row${checked ? '' : ' dwc-off'}${disabled ? ' dwc-blocked' : ''}` },
        h('input', { type: 'checkbox', checked, disabled, onChange: (e) => onChange(e.target.checked) }),
        h('div', { className: 'dwc-row-main' },
          h('div', { className: 'dwc-row-name' }, name, meta ? h('span', { className: 'dwc-row-meta' }, meta) : null),
          note ? h('div', { className: 'dwc-row-note' }, note) : null,
          description ? h('div', { className: 'dwc-row-desc' }, description) : null))
    }

    function Section({ title, on, total, onAll, onNone, children }) {
      return h('div', { className: 'dwc-section' },
        h('div', { className: 'dwc-head' },
          h('span', { className: 'dwc-head-title' }, title),
          h('span', { className: 'dwc-head-count' }, t('count', { on, total })),
          h('span', { className: 'dwc-head-spacer' }),
          total > 0 ? h('button', { type: 'button', className: 'dwc-link', onClick: onAll }, t('all')) : null,
          total > 0 ? h('button', { type: 'button', className: 'dwc-link', onClick: onNone }, t('none')) : null),
        children)
    }

    function Dialog({ store }) {
      const target = useSyncExternalStore(store.subscribe, store.get)
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [saving, setSaving] = useState(false)
      const [query, setQuery] = useState('')
      const [offSkills, setOffSkills] = useState(() => new Set())
      const [offServers, setOffServers] = useState(() => new Set())

      useEffect(() => {
        setData(null)
        setError(null)
        setQuery('')
        setSaving(false)
        if (!target) return
        let live = true
        request(`state?workspaceId=${encodeURIComponent(target.workspaceId)}`)
          .then((next) => {
            if (!live) return
            setData(next)
            setOffSkills(new Set(next.skills.filter((row) => !row.enabled).map((row) => row.name)))
            setOffServers(new Set(next.mcp.filter((row) => !row.enabled).map((row) => row.server)))
          })
          .catch((caught) => { if (live) setError(String(caught?.message ?? caught)) })
        return () => { live = false }
      }, [target])

      const close = () => store.set(null)
      const toggle = (setter, key, on) => setter((prev) => {
        const next = new Set(prev)
        if (on) next.delete(key)
        else next.add(key)
        return next
      })

      const skills = data?.skills ?? []
      const servers = data?.mcp ?? []
      const shownSkills = useMemo(() => skills.filter((row) => matches(query, row.name, row.description)), [skills, query])
      const togglableSkills = shownSkills.filter((row) => !isBlocked(row))
      const shownServers = useMemo(() => servers.filter((row) => matches(query, row.server, ...row.tools)), [servers, query])

      const save = () => {
        if (!target || !data) return
        setSaving(true)
        setError(null)
        request('save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: target.workspaceId,
            disabledSkills: [...offSkills],
            disabledMcpServers: [...offServers],
          }),
        })
          .then(() => close())
          .catch((caught) => {
            setSaving(false)
            setError(String(caught?.message ?? caught))
          })
      }

      const setMany = (setter, keys, on) => setter((prev) => {
        const next = new Set(prev)
        for (const key of keys) {
          if (on) next.delete(key)
          else next.add(key)
        }
        return next
      })

      const name = target?.label || data?.workspace?.title || ''
      let body
      if (!data && !error) body = h('div', { className: 'dwc-hint' }, t('loading'))
      else if (!data) body = h('div', { className: 'dwc-error' }, t('error', { message: error }))
      else {
        body = h('div', { className: 'dwc-body' },
          h('div', { className: 'dwc-hint' }, t('hint')),
          h('input', {
            className: 'dwc-search',
            type: 'search',
            placeholder: t('search'),
            value: query,
            'data-modal-autofocus': '',
            onChange: (e) => setQuery(e.target.value),
          }),
          h(Section, {
            title: t('skills'),
            on: skills.filter((row) => !isBlocked(row) && !offSkills.has(row.name)).length,
            total: skills.length,
            onAll: () => setMany(setOffSkills, togglableSkills.map((row) => row.name), true),
            onNone: () => setMany(setOffSkills, togglableSkills.map((row) => row.name), false),
          },
          data.skillsComplete === false ? h('div', { className: 'dwc-warn' }, t('partial')) : null,
          shownSkills.length === 0 ? h('div', { className: 'dwc-empty' }, t('empty')) : null,
          ...shownSkills.map((row) => h(Row, {
            key: row.name,
            checked: !isBlocked(row) && !offSkills.has(row.name),
            disabled: isBlocked(row),
            onChange: (on) => toggle(setOffSkills, row.name, on),
            name: row.name,
            meta: row.missing ? t('missing') : isBlocked(row) ? `${row.provider} · ${t('blockedShort')}` : row.provider,
            note: skillNote(row),
            description: row.description,
          }))),
          h(Section, {
            title: t('mcp'),
            on: servers.filter((row) => !offServers.has(row.server)).length,
            total: servers.length,
            onAll: () => setMany(setOffServers, shownServers.map((row) => row.server), true),
            onNone: () => setMany(setOffServers, shownServers.map((row) => row.server), false),
          },
          shownServers.length === 0 ? h('div', { className: 'dwc-empty' }, t('emptyMcp')) : null,
          ...shownServers.map((row) => h(Row, {
            key: row.server,
            checked: !offServers.has(row.server),
            onChange: (on) => toggle(setOffServers, row.server, on),
            name: row.server,
            meta: row.connected ? t('tools', { n: row.tools.length }) : t('disconnected'),
            description: row.tools.join(', '),
          }))),
          error ? h('div', { className: 'dwc-error' }, t('error', { message: error })) : null)
      }

      return h(P.Modal, {
        open: target !== null,
        onClose: close,
        title: t('title', { name }),
        closeLabel: t('close'),
        className: 'dwc-dialog',
        description: data?.workspace?.path,
        children: body,
        footer: h('div', { className: 'dwc-footer' },
          h(P.Button, { variant: 'outline', onClick: close }, t('cancel')),
          h(P.Button, { variant: 'primary', disabled: !data || saving, onClick: save }, saving ? t('saving') : t('save'))),
      })
    }

    /**
     * Watch for the workspace "..." menu and add our row to it. The press on
     * a workspace row's action button records the row; the portal menu that
     * appears right after is that row's menu.
     */
    function installMenuHook(store) {
      let pending = null

      const onPress = (event) => {
        const target = event.target instanceof Element ? event.target : null
        const button = target?.closest('button')
        const row = button?.closest(`[data-row-key^="${ROW_PREFIX}"]`)
        if (!button || !row) return
        const workspaceId = row.getAttribute('data-row-key').slice(ROW_PREFIX.length)
        if (!workspaceId) {
          pending = null
          return
        }
        const label = row.querySelector('[class*="title"]')?.textContent ?? ''
        pending = { workspaceId, label, anchor: button, at: Date.now() }
      }

      const decorate = (menu) => {
        if (!pending || Date.now() - pending.at > MENU_WINDOW_MS) return
        if (menu.querySelector('[data-dwc-item]')) return
        const items = menu.querySelectorAll('button[role="menuitem"]')
        // The workspace menu is exactly rename + delete.
        if (items.length !== 2) return
        const first = items[0]
        const wrap = first.parentElement
        if (!wrap || wrap === menu) return
        const { workspaceId, label, anchor } = pending
        pending = null

        const clone = wrap.cloneNode(true)
        clone.setAttribute('data-dwc-item', '')
        const button = clone.querySelector('button[role="menuitem"]')
        const spans = button.querySelectorAll(':scope > span')
        const icon = spans.length > 1 ? spans[0] : null
        const text = spans.length > 1 ? spans[1] : spans[0]
        if (icon) icon.innerHTML = ICON
        if (text) text.textContent = t('menu')
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          // Close the host menu through its own toggle, then open the dialog.
          if (anchor.isConnected) anchor.click()
          else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          store.set({ workspaceId, label })
        })
        wrap.after(clone)
      }

      const observer = new MutationObserver((records) => {
        if (!pending) return
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            const menus = node.matches('[role="menu"]') ? [node] : node.querySelectorAll('[role="menu"]')
            for (const menu of menus) decorate(menu)
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener('pointerdown', onPress, true)
      document.addEventListener('click', onPress, true)
      return () => {
        observer.disconnect()
        document.removeEventListener('pointerdown', onPress, true)
        document.removeEventListener('click', onPress, true)
        for (const item of document.querySelectorAll('[data-dwc-item]')) item.remove()
      }
    }

    return {
      inject: [],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.owner = PACKAGE
          style.textContent = CSS
          document.head.appendChild(style)

          const store = createStore()
          const host = document.createElement('div')
          host.dataset.owner = PACKAGE
          document.body.appendChild(host)
          const root = createRoot(host)
          root.render(h(Dialog, { store }))

          const unhook = installMenuHook(store)
          return () => {
            unhook()
            root.unmount()
            host.remove()
            style.remove()
          }
        }, 'dsh-workspace-capabilities: workspace menu + dialog')
      },
    }
  },
})
