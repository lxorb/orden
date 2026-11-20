import { expect, test, vi } from 'vitest'

class FakeChannel {
  onmessage: (value: unknown) => void = () => undefined
}
const asked: string[] = []
const answers = new Map<string, () => void>()
const opened: Record<string, unknown>[] = []
async function fakeInvoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (command === 'ai_cli_open') {
    opened.push(args.opening as Record<string, unknown>)
    return null
  }
  const say = args.say as { kind: string } | undefined
  const name = say ? say.kind : command
  asked.push(name)
  if (name === 'interrupt') throw new Error('not answering')
  await new Promise<void>((done) => answers.set(name, done))
  return null
}
vi.mock('../../../crate/src/native', () => ({ Channel: FakeChannel }))
vi.mock('../../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../../platform/src/tauri')>()),
  invoke: fakeInvoke,
}))
const { openSession } = await import('./session')
const settle = () => new Promise((done) => setTimeout(done, 0))
test('what is said to a session reaches it one at a time, in the order it was said', async () => {
  const session = await openSession(
    {
      tool: 'codex',
      agent: { id: 'cx', name: 'Codex' },
      mode: null,
      model: null,
      effort: null,
    },
    () => undefined,
  )
  const model = session.say({ kind: 'model', model: 'gpt' })
  const interrupt = session.say({ kind: 'interrupt' })
  const turn = session.say({ kind: 'turn', text: 'hi', images: [] })
  const closed = session.close()
  await settle()
  expect(asked).toEqual(['model'])
  answers.get('model')?.()
  await model
  await expect(interrupt).rejects.toThrow('not answering')
  await settle()
  expect(asked).toEqual(['model', 'interrupt', 'turn'])
  answers.get('turn')?.()
  await turn
  await settle()
  expect(asked).toEqual(['model', 'interrupt', 'turn', 'ai_cli_close'])
  answers.get('ai_cli_close')?.()
  await closed
})
test('a session of an account the vault moved to a fresh id goes by the agent rights it had, as that account', async () => {
  const { keepMoves } = await import('../moves')
  keepMoves({ cx: 'cx-2' })
  await openSession(
    {
      tool: 'codex',
      agent: { id: 'cx-2', name: 'Codex' },
      mode: 'auto',
      model: null,
      effort: null,
    },
    () => undefined,
  )
  expect(opened.at(-1)).toMatchObject({
    agent: { id: 'cx', name: 'Codex', readerTabs: true },
    account: 'cx-2',
  })
})
test('a session opened with only some tools names just those, and an empty list allows none, while one without a list names no list', async () => {
  const opening = {
    tool: 'codex',
    agent: { id: 'cx', name: 'Codex' },
    mode: 'auto',
    model: null,
    effort: null,
  } as const
  await openSession({ ...opening, only: ['task_set', 'task_note'] }, () => undefined)
  expect(opened.at(-1)?.only).toEqual(['task_set', 'task_note'])
  await openSession({ ...opening, only: [] }, () => undefined)
  expect(opened.at(-1)?.only).toEqual([])
  await openSession(opening, () => undefined)
  expect(opened.at(-1)).not.toHaveProperty('only')
})
test('a session opened for a thread of a space names the space, and one of no space names none', async () => {
  const opening = {
    tool: 'codex',
    agent: { id: 'cx', name: 'Codex' },
    mode: 'auto',
    model: null,
    effort: null,
    thread: 't1',
  } as const
  await openSession({ ...opening, space: 'work' }, () => undefined)
  expect(opened.at(-1)).toMatchObject({ thread: 't1', space: 'work' })
  await openSession(opening, () => undefined)
  expect(opened.at(-1)).not.toHaveProperty('space')
})
