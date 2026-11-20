import { describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => [] as { mode: string }[])
vi.mock('../../ai-chat/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai-chat/src/api')>()),
  helperRun: () =>
    Promise.resolve({
      runAgent: (_args: unknown, asker: { mode: string }) => {
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
  test("works in the mode of the chat that asked, not the grant's", async () => {
    asked.length = 0
    expect(await ask({ ...grant, chat_mode: 'plan' })).toMatchObject({ status: 'ok' })
    expect(asked.map((one) => one.mode)).toEqual(['plan'])
  })
  test('is refused, and none is started, when the mode of the chat that asked is not known', async () => {
    asked.length = 0
    await expect(ask(grant)).rejects.toThrow('the mode of the chat that asked is not known')
    expect(asked).toEqual([])
  })
})
