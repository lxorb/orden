import { describe, expect, test, vi } from 'vitest'
import * as taskLine from '@orden/markdown/task-line'
import { scanNote, type ScannedNote } from '@orden/scan/note'
import { scanRows } from '@orden/bases/scan'
import { type Host, RowsStore } from './store'

vi.mock('@orden/markdown/task-line', { spy: true })

const CLOCKED = process.env.ORDEN_PERF === '1'

const NOTES = 5_000
const TASKS_EACH = 2

function note(at: number): string {
  return [
    '---',
    `status: ${at % 3 ? 'open' : 'done'}`,
    `priority: ${at % 4}`,
    `tags: [work, n${at % 50}]`,
    '---',
    `# Note ${at}`,
    'Some words about the thing, with a [[link]] in them.',
    '## Errands',
    `- [ ] Call number ${at} [time:: 16:00] #admin ⏫ 📅 2026-10-0${(at % 9) + 1}`,
    `  - [${at % 2 ? 'x' : ' '}] Find the card for ${at} 🔁 every week ✅ 2026-10-01`,
    'And a closing paragraph.',
  ].join('\n')
}

const scanned: ScannedNote[] = Array.from({ length: NOTES }, (_, at) => {
  const text = note(at)
  return {
    ...scanNote(`folder ${at % 20}/Note ${at}.md`, text),
    ...scanRows(text),
    stamp: { size: text.length, mtime: 1, ctime: 1 },
  }
})

function store(): RowsStore {
  const host: Host = {
    scan: () => Promise.resolve(null),
    read: () => Promise.resolve(null),
    open: () => ({ root: '/big', scanned: () => Promise.resolve(), notes: () => scanned }),
    breathe: () => Promise.resolve(),
    now: () => 2,
    vault: () => Promise.resolve(false),
  }
  return new RowsStore(host)
}

async function read(rows: RowsStore) {
  rows.spacesAre([{ root: '/big', name: 'Big' }])
  for (let turn = 0; turn < 100 && !rows.ready; turn++) await new Promise((go) => setTimeout(go, 0))
}

describe('the rows of a space of 5,000 notes and 10,000 tasks', () => {
  test('are made in one pass, sharing each note across its rows', async () => {
    const rows = store()
    const started = performance.now()
    await read(rows)
    const took = performance.now() - started

    const all = rows.of()
    expect(all).toHaveLength(NOTES * (1 + TASKS_EACH))
    expect(all.filter((row) => row.task?.done)).toHaveLength(NOTES / 2)
    expect(new Set(all.map((row) => row.file)).size).toBe(NOTES)
    expect(new Set(all.map((row) => row.note)).size).toBe(NOTES)
    if (CLOCKED) expect(took).toBeLessThan(2_000)
  })

  test('and a save reads the note saved and nothing else of the space', async () => {
    const rows = store()
    await read(rows)
    const readTask = vi.mocked(taskLine.readTask)

    readTask.mockClear()
    const text = note(7)
    const times: number[] = []
    for (let round = 0; round < 50; round++) {
      const started = performance.now()
      rows.saved('/big/folder 7/Note 7.md', text)
      times.push(performance.now() - started)
    }

    expect(readTask.mock.calls).toHaveLength(50 * TASKS_EACH)
    times.sort((one, other) => one - other)
    if (CLOCKED) expect(times[25]).toBeLessThan(2)
  })

  test('and nothing at all happens while nobody saves', async () => {
    const rows = store()
    await read(rows)
    const heard: unknown[] = []
    rows.watch((change) => heard.push(change))
    const readTask = vi.mocked(taskLine.readTask)
    readTask.mockClear()

    const first = rows.of('Big')
    for (let ask = 0; ask < 1_000; ask++) expect(rows.of('Big')).toBe(first)
    expect(readTask).not.toHaveBeenCalled()
    expect(heard).toEqual([])
  })
})
