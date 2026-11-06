import { expect, test, vi } from 'vitest'
import { newThread } from '../chat/threads'
import type { Thread } from '../chat/types'
import type { Host } from './host'
import type { Ended } from './types'

vi.mock('../../workspace.svelte', () => ({
  workspace: { spaces: [{ id: 'space', root: '/vault' }], activeSpace: null, leftOutOf: () => [] },
}))

const { fork, research, subtask } = await import('./helpers')

function hosted() {
  const adopted: Thread[] = []
  const lines: { text: string; threads?: readonly string[] }[] = []
  const ended: Ended = { stop: 'end', turn: null, usage: null }
  const host = {
    turn: () => Promise.resolve(ended),
    adopt: (thread: Thread) => adopted.push(thread),
    touched: vi.fn(),
    line: (_thread: Thread, text: string, _code?: string, threads?: readonly string[]) =>
      lines.push({ text, ...(threads ? { threads } : {}) }),
  } as unknown as Host
  return { host, adopted, lines }
}

function parent(): Thread {
  const thread = newThread('space', 'p', 'm')
  thread.title = 'Serie 6'
  thread.turns = [{ id: 'y1', role: 'you', at: 1, parts: [] }]
  return thread
}

test('/subtask and /deep-research run a helper of the parent, which their line opens', async () => {
  const { host, adopted, lines } = hosted()
  const from = parent()
  await subtask(host, from, 'check the proof')
  await research(host, from, 'who proved it')
  expect(adopted.map((one) => one.parent)).toEqual([from.id, from.id])
  expect(lines.map((one) => one.threads)).toEqual([[adopted[0]?.id], [adopted[1]?.id]])
})

test('/fork leaves a chat of the reader’s own, even of a helper', () => {
  const { host, adopted } = hosted()
  const helper = { ...parent(), parent: 'above' }
  fork(host, helper, '')
  expect(adopted[0]).not.toHaveProperty('parent')
})
