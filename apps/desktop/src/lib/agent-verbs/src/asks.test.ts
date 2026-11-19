import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Call } from './call'

const sent: { command: string; args: Record<string, unknown> }[] = []
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    sent.push({ command, args })
    return Promise.resolve({ status: 'ok' })
  },
}))
const { asked } = await import('./asks')
const GRANT = {
  id: 'orden-cc',
  builtIn: false,
  name: 'Claude Code',
  scopes: [],
  spaces: 'all' as const,
  mode: 'confirm' as const,
  programs: [],
  sites: {},
}
function call(caller: Call['caller']): Call {
  return { verb: 'write_note', args: { path: 'Plan.md' }, caller }
}
beforeEach(() => {
  sent.length = 0
})
describe('a question names the thread that raised it', () => {
  test('a call from a thread carries that thread into agents_ask', async () => {
    await asked(call({ agent: GRANT, thread: 'thread-a' }), 'writing', 'Write Plan.md')
    expect(sent).toEqual([
      { command: 'agents_ask', args: expect.objectContaining({ agent: 'orden-cc', thread: 'thread-a' }) },
    ])
  })
  test('two threads on one program ask apart, and a call from no thread names none', async () => {
    await asked(call({ agent: GRANT, thread: 'thread-a' }), 'writing', 'Write Plan.md')
    await asked(call({ agent: GRANT, thread: 'thread-b' }), 'writing', 'Write Plan.md')
    await asked(call({ agent: GRANT }), 'writing', 'Write Plan.md')
    expect(sent.map((one) => one.args.thread)).toEqual(['thread-a', 'thread-b', undefined])
    expect(sent.map((one) => 'thread' in one.args)).toEqual([true, true, false])
  })
})
