import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcpServerOf, normalizePath, normalizeState, skillRow } from '../lib/index.js'

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
  assert.deepEqual(state, { version: 1, workspaces: { '/w1': { disabledSkills: ['a', 'b'], disabledMcpServers: ['x'] } } })
  assert.deepEqual(normalizeState(null), { version: 1, workspaces: {} })
})

test('skillRow carries the candidate invocation policy', () => {
  const provider = { name: 'dsh-skills-manager-external' }
  const off = skillRow({ candidate: { name: 'a', description: 'd', invocation: { modelInvocable: false, userInvocable: false } }, provider })
  assert.deepEqual(off, { name: 'a', description: 'd', provider: 'dsh-skills-manager-external', modelInvocable: false, userInvocable: false })
  const plain = skillRow({ candidate: { name: 'b' }, provider: undefined })
  assert.deepEqual(plain, { name: 'b', description: '', provider: '', modelInvocable: true, userInvocable: true })
})
