import { describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('../../ai-chat/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai-chat/src/api')>()),
  helperRun: () =>
    Promise.resolve({
      runAgent: (_args: unknown, asker: Record<string, unknown>) => {
        asked.push(asker)
        return Promise.resolve({ agent: 'h1' })
      },
      agentResult: () => Promise.resolve({}),
    }),
}))
const { runAgent } = await import('./helpers')
const { callerOf } = await import('../../automation/src/api')
const SCOPES = [
  'context',
  'notes.read',
  'notes.write',
  'chats.read',
  'chats.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.network',
  'terminal',
  'agents',
]
const grant = {
  id: 'orden-anthropic',
  name: 'Claude',
  scopes: SCOPES,
  spaces: 'all',
  mode: 'unsupervised',
  built_in: true,
}
const ask = (told: Record<string, unknown>) =>
  runAgent({ verb: 'run_agent', caller: callerOf(told), args: { prompt: 'Find the herons.' } })
describe("a helper asked for by the app's own agent", () => {
  test("works in the mode, tools and space of the chat that asked, not the grant's", async () => {
    asked.length = 0
    const chat = { mode: 'plan', without: ['edit_note'], only: ['read_note'], space: 'Work' }
    expect(await ask({ ...grant, chat })).toMatchObject({ status: 'ok' })
    expect(asked).toMatchObject([{ mode: 'plan', without: ['edit_note'], only: ['read_note'], space: 'Work' }])
  })
  test('is refused, and none is started, when the mode of the chat that asked is not known', async () => {
    asked.length = 0
    await expect(ask(grant)).rejects.toThrow('the mode of the chat that asked is not known')
    await expect(ask({ ...grant, chat_mode: 'plan' })).rejects.toThrow('the mode of the chat that asked is not known')
    expect(asked).toEqual([])
  })
})
