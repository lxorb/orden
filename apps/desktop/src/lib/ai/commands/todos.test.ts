import { describe, expect, test, vi } from 'vitest'
import type { Thread } from '../../ai-providers/src/chat/types'
import type { Host } from './host'

vi.mock('../../task-actions', () => ({
  listed: () => ({
    total: 2,
    tasks: [
      { at: 't1', space: 'home', text: 'Pay rent', due: '2020-01-01', priority: 1 },
      { at: 't2', space: '', text: 'Call mum' },
    ],
  }),
}))

const { planDay, showTasks } = await import('./todos')

function host(said = '') {
  const ask = vi.fn(() => Promise.resolve(said))
  const lines: { text: string; code?: string }[] = []
  const sent: { text: string; once: unknown }[] = []
  const fake = {
    panel: { send: (text: string) => sent.push({ text, once: undefined }) },
    line: (_thread: Thread, text: string, code?: string) =>
      lines.push({ text, ...(code ? { code } : {}) }),
    ask,
    turn: (_thread: Thread, text: string, once: unknown) => {
      sent.push({ text, once })
      return Promise.resolve({ stop: 'end', turn: null, usage: null })
    },
  }
  fake.panel = Object.assign(fake.panel, {
    turn: fake.turn,
    setMode: () => undefined,
  })
  return { fake: fake as unknown as Host, lines, sent, ask }
}

const thread = { id: 't' } as Thread
const shown = (lines: { text: string }[]) =>
  JSON.parse(lines[0]?.text ?? '{}') as { tasks: { text: string }[]; filter?: string }

describe('/tasks', () => {
  test("today's todos, as rows the thread draws", async () => {
    const { fake, lines } = host()
    await showTasks(fake, thread, '')
    expect(lines[0]?.code).toBe('tasks')
    expect(shown(lines).tasks.map((one) => one.text)).toEqual(['Pay rent', 'Call mum'])
    expect(shown(lines).filter).toBeUndefined()
  })

  test('words after the command are shown above the rows', async () => {
    const { fake, lines } = host()
    await showTasks(fake, thread, 'what is urgent')
    expect(shown(lines)).toMatchObject({ filter: 'what is urgent' })
  })
})

describe('/today', () => {
  test('asks the model to plan in Auto mode, with what the reader added', () => {
    const { fake, sent } = host()
    planDay(fake, thread, 'gym at six')
    expect(sent[0]?.text).toMatch(/^Plan my day\./)
    expect(sent[0]?.text).toMatch(/gym at six$/)
    expect(sent[0]?.once).toEqual({ mode: 'auto' })
  })
})
