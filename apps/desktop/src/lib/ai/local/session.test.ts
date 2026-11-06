import { expect, test, vi } from 'vitest'

class FakeChannel {
  onmessage: (value: unknown) => void = () => undefined
}

const asked: string[] = []
const answers = new Map<string, () => void>()

async function fakeInvoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (command === 'ai_cli_open') return null
  const say = args.say as { kind: string } | undefined
  const name = say ? say.kind : command
  asked.push(name)
  if (name === 'interrupt') throw new Error('not answering')
  await new Promise<void>((done) => answers.set(name, done))
  return null
}

vi.mock('../../native', () => ({ Channel: FakeChannel }))
vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
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
