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
