/** The work a thread started, of every kind, as one tree: a command's helper (`/subtask`,
 *  `/fork`, `/batch`) and a `run_agent` helper under it, or the other way round, are
 *  all the top thread's to review and to stop, and the thread lists are written down. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ModelInfo, Thread } from '../chat/types'
import type { Host } from '../commands/host'
import type { Ended } from '../commands/types'
import type { Provider } from '../providers'

const written = vi.hoisted(() => [] as string[])

vi.mock('../chat/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chat/threads')>()),
  keepThread: (thread: Thread) => {
    written.push(thread.id)
    return Promise.resolve()
  },
}))

vi.mock('../../workspace.svelte', () => ({
  workspace: { spaces: [{ id: 'Notes', root: '/n' }], activeSpace: null, leftOutOf: () => [] },
}))

// The space's search: one note in Inbox/.
vi.mock('../../search/space', () => ({
  searchSpace: (
    _root: string,
    _query: unknown,
    _terms: string[],
    _most: number,
    onFound: (found: { hits: unknown[]; loose: unknown[] }) => void,
  ) => {
    onFound({ hits: [{ path: '/n/Inbox/a.md' }], loose: [] })
    return Promise.resolve()
  },
}))

const { helpers } = await import('./helpers.svelte')
const { batch, subtask } = await import('../commands/helpers')
const { changesOf } = await import('../review/changes')
type Roads = Parameters<typeof helpers.start>[1]
type Tree = Thread & { helpers?: string[] }

const model = (id: string): ModelInfo => ({
  id,
  name: id,
  window: null,
  efforts: ['auto'],
  images: false,
  fast: false,
})
const CLAUDE: Provider = { id: 'claude-code', kind: 'claude-code', name: '', model: '' }
const CODEX: Provider = { id: 'codex', kind: 'codex', name: '', model: '' }
const stopped: Ended = { stop: 'stopped', turn: null, usage: null }

/** Turns that run until they are stopped, each heard with its thread and signal. */
const turns: { thread: Thread; signal: AbortSignal | undefined }[] = []
function held(thread: Thread, signal?: AbortSignal): Promise<Ended> {
  turns.push({ thread, signal })
  return new Promise((resolve) => {
    signal?.addEventListener('abort', () => resolve(stopped), { once: true })
  })
}

const roads: Roads = {
  offered: () =>
    Promise.resolve([
      { provider: CLAUDE, models: [model('opus')] },
      { provider: CODEX, models: [model('gpt-6-astra')] },
    ]),
  run: (thread, _text, signal) => held(thread, signal),
}

const host = {
  turn: (thread: Thread, _text: string, once?: { signal?: AbortSignal }) =>
    held(thread, once?.signal),
  adopt: vi.fn(),
  touched: vi.fn(),
  line: vi.fn(),
} as unknown as Host

const top = (): Tree => ({
  id: `top-${crypto.randomUUID()}`,
  space: 'Notes',
  title: '',
  provider: CLAUDE.id,
  model: 'opus',
  effort: 'auto',
  mode: 'full',
  turns: [],
  usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
  created: 0,
  updated: 0,
})

const asked = (from: Thread) => ({
  parent: from,
  space: 'Notes',
  prompt: 'Fix the headings in Projects/A.',
  description: 'headings',
  model: 'astra',
  mode: from.mode,
})

/** An edit of the helper's, on its own provider, its call naming its thread. */
const editBy = (thread: string) => ({
  id: 'nib-codex:1',
  agent: 'nib-codex',
  path: '/n/Projects/A.md',
  at: 5,
  spots: [],
  thread,
})

/** The thread of the last turn started. */
async function started(count: number): Promise<Thread> {
  await vi.waitFor(() => expect(turns).toHaveLength(count))
  const last = turns.at(-1)?.thread
  if (!last) throw new Error('started')
  return last
}

beforeEach(() => {
  for (const one of helpers.all) helpers.stop(one.id)
  helpers.all = []
  turns.length = 0
  written.length = 0
})

describe('the review of the top thread', () => {
  test('takes in a run_agent helper a /subtask started', async () => {
    const thread = top()
    void subtask(host, thread, 'tidy every note in Projects/')
    const sub = await started(1)
    const helper = await helpers.start(asked(sub), roads)
    if ('refused' in helper) throw new Error(helper.refused)

    expect(thread.helpers).toEqual([sub.id, helper.id])
    expect(changesOf(thread, [editBy(helper.id)], () => null, new Set())).toHaveLength(1)
    // Its list is written down now, not only at its next turn.
    expect(written).toContain(thread.id)
    helpers.stopUnder(thread.id)
  })

  test('takes in a /subtask typed in a run_agent helper', async () => {
    const thread = top()
    const helper = await helpers.start(asked(thread), roads)
    if ('refused' in helper) throw new Error(helper.refused)
    const under = await started(1)
    void subtask(host, under, 'look closer')
    const sub = await started(2)

    expect(thread.helpers).toEqual([helper.id, sub.id])
    helpers.stopUnder(thread.id)
  })
})

describe('stopping the top thread', () => {
  test('stops a run_agent helper a /batch note started', async () => {
    const thread = top()
    void batch(host, thread, 'fix the headings in Inbox/')
    const note = await started(1)
    const helper = await helpers.start(asked(note), roads)
    if ('refused' in helper) throw new Error(helper.refused)
    await started(2)

    helpers.stopUnder(thread.id)

    expect(turns.map((one) => one.signal?.aborted)).toEqual([true, true])
    expect(thread.helpers).toEqual([note.id, helper.id])
  })
})
