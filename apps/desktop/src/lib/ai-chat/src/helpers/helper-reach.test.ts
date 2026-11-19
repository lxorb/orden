import { describe, expect, test, vi } from 'vitest'
import type { Provider } from '../../../ai-providers/src/providers'

const asked: { asker: unknown }[] = []
vi.mock('../api', () => ({
  helperRun: async () => ({
    runAgent: (_args: unknown, asker: unknown) => {
      asked.push({ asker })
      return Promise.resolve({ refused: 'not here' })
    },
    agentResult: () => Promise.resolve({ refused: 'no' }),
  }),
}))

const { offeredWithin } = await import('./run')
const { runAgent } = await import('../../../agent-host/src/helpers')
const { callerOf } = await import('../../../automation/src/api')

const provider = (id: string): Provider => ({ id, kind: id, name: id, model: '' }) as Provider
const CLAUDE = { provider: provider('claude-code'), models: [] }
const CODEX = { provider: provider('codex'), models: [] }
const narrow = { scopes: ['notes.read', 'agents'], spaces: ['Work'], sites: {}, programs: [] }
const wide = (id: string) => ({
  id,
  scopes: ['notes.read', 'terminal', 'agents'],
  spaces: 'all' as const,
  sites: {},
  programs: [],
})

describe('a helper of an agent whose grant is narrowed', () => {
  test('runs on another provider only if that provider reaches no further', () => {
    const grants = [{ id: 'orden-claude-code', ...narrow }, wide('orden-codex')]
    expect(offeredWithin([CLAUDE, CODEX], narrow, 'claude-code', grants)).toEqual([CLAUDE])
    const alike = [
      { id: 'orden-claude-code', ...narrow },
      { id: 'orden-codex', ...narrow },
    ]
    expect(offeredWithin([CLAUDE, CODEX], narrow, 'claude-code', alike)).toEqual([CLAUDE, CODEX])
    expect(offeredWithin([CLAUDE, CODEX], narrow, 'claude-code', null)).toEqual([CLAUDE])
  })

  test('runs on another provider only if its sites, scripts, asks and supervision are as strict', () => {
    const scopes = ['notes.read', 'browser', 'agents']
    const grant = (id: string, more: object) => ({
      id,
      scopes,
      spaces: 'all' as const,
      sites: {},
      programs: [],
      ...more,
    })
    const offered = (asker: object, helper: object) =>
      offeredWithin([CLAUDE, CODEX], { id: 'orden-claude-code', ...narrow }, 'claude-code', [
        grant('orden-claude-code', asker),
        grant('orden-codex', helper),
      ]).map((one) => one.provider.id)
    const both = ['claude-code', 'codex']
    expect(offered({ sites: { 'bank.example': 'deny' } }, {})).toEqual(['claude-code'])
    expect(offered({ sites: { 'bank.example': 'deny' } }, { sites: { 'bank.example': 'deny' } })).toEqual(both)
    expect(offered({ sites: { 'mail.example': 'agent-store' } }, {})).toEqual(['claude-code'])
    expect(
      offered({ sites: { 'bank.example': 'deny' } }, { sites: { 'bank.example': 'deny', 'my.bank.example': 'allow' } }),
    ).toEqual(['claude-code'])
    expect(offered({}, { sites: { 'bank.example': 'deny' } })).toEqual(both)
    expect(offered({ scripts: ['docs.example'] }, { scripts: ['bank.example'] })).toEqual(['claude-code'])
    expect(offered({ scripts: ['docs.example'] }, { scripts: ['a.docs.example'] })).toEqual(both)
    expect(offered({ mode: 'confirm' }, { mode: 'unsupervised' })).toEqual(['claude-code'])
    expect(offered({}, { mode: 'autonomous' })).toEqual(['claude-code'])
    expect(offered({}, { asks: { terminal: false } })).toEqual(['claude-code'])
    expect(offered({ asks: { terminal: false } }, {})).toEqual(both)
    expect(offered({}, { always: { 'shop.example': ['paying'] } })).toEqual(['claude-code'])
  })

  test('under Full permissions the asker reaches every scope, program and script, but not past a site it blocks', () => {
    const kept = { id: 'harness', ...narrow, spaces: 'all' as const, mode: 'unsupervised' }
    const grants = [kept, wide('orden-claude-code')]
    expect(offeredWithin([CLAUDE], { ...kept, mode: 'autonomous' }, null, grants)).toEqual([CLAUDE])
    expect(offeredWithin([CLAUDE], kept, null, grants)).toEqual([])
    const blocked = { ...kept, sites: { 'bank.example': 'deny' } }
    const theirs = [blocked, wide('orden-claude-code')]
    expect(offeredWithin([CLAUDE], { ...blocked, mode: 'autonomous' }, null, theirs)).toEqual([])
  })

  test('a session that asks first starts no helper that asks less, whatever its kept grant says', () => {
    const kept = { ...wide('orden-codex'), mode: 'unsupervised' }
    const grants = [kept, { ...wide('orden-claude-code'), mode: 'unsupervised' }]
    expect(offeredWithin([CLAUDE], kept, 'codex', grants)).toEqual([CLAUDE])
    expect(offeredWithin([CLAUDE], { ...kept, mode: 'confirm' }, 'codex', grants)).toEqual([])
  })

  test('a client under Full permissions starts a helper; a narrower or site-blocking one is refused', async () => {
    const client = (mode: string, sites: Record<string, string> = {}) =>
      callerOf({ id: 'codex', name: 'Codex', scopes: ['notes.read'], spaces: 'all', mode, sites })
    const run = (caller: ReturnType<typeof callerOf>) =>
      runAgent({ verb: 'run_agent', caller, args: { prompt: 'Find the herons.' } })
    await expect(run(client('autonomous'))).resolves.toMatchObject({
      status: 'error',
      message: 'not here',
    })
    await expect(run(client('unsupervised'))).rejects.toThrow('grant is narrower')
    await expect(run(client('autonomous', { 'bank.example': 'deny' }))).rejects.toThrow('grant is narrower')
    asked.length = 0
  })

  test('carries the reach of the built-in agent that asked for it', async () => {
    const caller = callerOf({
      id: 'orden-claude-code',
      name: 'Claude Code',
      built_in: true,
      scopes: ['notes.read', 'agents'],
      spaces: ['Work'],
      mode: 'unsupervised',
    })
    await runAgent({ verb: 'run_agent', caller, args: { prompt: 'x', model: 'astra' } })
    expect(asked[0]?.asker).toMatchObject({ reach: { spaces: ['Work'] } })
  })
})
