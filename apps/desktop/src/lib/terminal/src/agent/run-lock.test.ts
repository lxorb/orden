import { describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../../automation/src/api'

const spaceW = { id: 'w', root: '/s/Work', name: 'Work' }

vi.mock('../../../workspace/src/api', () => ({
  agentMarks: { opened: {}, on: {} },
  workspace: { spaces: [spaceW], activeSpace: spaceW, tabs: [], spaceOf: () => 'w' },
}))

vi.mock('../shells.svelte', () => ({
  shells: { ask: async () => [], chosen: { id: 'bash', name: 'bash' } },
}))

const channels: { onmessage: (message: unknown) => void }[] = []
vi.mock('../../../crate/src/api', () => ({
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined
    constructor() {
      channels.push(this)
    }
  },
}))

const calls: { name: string; args: Record<string, unknown> }[] = []
vi.mock('../../../platform/src/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  identifier: () => 'probe',
  platform: () => 'linux',
  invoke: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    if (name === 'agents_ask') return { status: 'ok' }
    if (name === 'pty_write' && args.data === 'exit\r') channels.at(-1)?.onmessage({ exit: 0 })
    return null
  },
}))

vi.mock('../../../agent-verbs/src/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  stopSignal: async () => ({ signal: new AbortController().signal, end: () => undefined }),
}))

const { protection } = await import('../../../protect/src/api')
const { runTerminal } = await import('./run')

const agent = (mode: string) =>
  callerOf({ id: 'x', name: 'X', scopes: ['terminal'], spaces: ['Work'], mode, programs: ['git'] })

describe('a listed command an agent runs', () => {
  test.each([
    ['in a folder shut to agents', 'Private'],
    ['in a folder holding one', null],
  ])('asks first %s', async (_, cwd) => {
    protection.set('/s/Work', '/s/Work/Private', 'password')
    calls.length = 0
    await runTerminal({
      verb: 'run_terminal',
      caller: agent('unsupervised'),
      args: { command: 'git status', ...(cwd ? { cwd } : {}) },
    })
    expect(calls.find((one) => one.name === 'agents_ask')?.args.category).toBe('terminal')
    protection.set('/s/Work', '/s/Work/Private', null)
  })

  test('runs unasked where nothing is shut', async () => {
    calls.length = 0
    const answer = await runTerminal({
      verb: 'run_terminal',
      caller: agent('unsupervised'),
      args: { command: 'git status' },
    })
    expect(answer).toMatchObject({ status: 'ok' })
    expect(calls.some((one) => one.name === 'agents_ask')).toBe(false)
  })

  test('asks as writing when every change is confirmed', async () => {
    calls.length = 0
    await runTerminal({
      verb: 'run_terminal',
      caller: agent('confirm'),
      args: { command: 'git status' },
    })
    expect(calls.find((one) => one.name === 'agents_ask')?.args.category).toBe('writing')
  })
})
