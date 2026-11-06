import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, string>())

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../undo-toast.svelte', () => ({ undoToast: () => undefined }))
vi.mock('../rows/rows.svelte', () => ({ rows: { of: () => [] } }))
vi.mock('../workspace/note-text', () => ({
  noteText: (_ws: unknown, path: string) => Promise.resolve(disk.get(path) ?? null),
  replaceInNotes: (_ws: unknown, changes: { path: string; after: string }[]) => {
    for (const one of changes) disk.set(one.path, one.after)
    return Promise.resolve(changes.length)
  },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'notes', name: 'Notes', root: '/n' }],
    undone: { last: null, stack: [] },
  },
}))

const { taskRow } = await import('./fixture')
const { tickRow, tickRows } = await import('./act')

const TODAY = '2026-11-06'
const lines = () => (disk.get('/n/Plan.md') ?? '').trim().split('\n')

describe('a todo pressed twice before its row comes back', () => {
  test('is done once, and a repeating one skips no occurrence', async () => {
    const line = `- [ ] Water the plants 🔁 every day 📅 ${TODAY}`
    disk.set('/n/Plan.md', `${line}\n`)
    const row = taskRow('Plan.md', line)
    await Promise.all([tickRow(row, TODAY), tickRow(row, TODAY)])
    await tickRow(row, TODAY)
    expect(lines()).toHaveLength(2)
    expect(lines().filter((one) => one.startsWith('- [x]'))).toHaveLength(1)
  })

  test('that is plain is ticked, not ticked and unticked again', async () => {
    const line = '- [ ] Post the letter'
    disk.set('/n/Plan.md', `${line}\n`)
    const row = taskRow('Plan.md', line)
    await tickRow(row, TODAY)
    await tickRow(row, TODAY)
    expect(lines()[0]).toMatch(/^- \[x\] Post the letter/)
  })

  test('by its key, held down so it repeats, is ticked once', async () => {
    const line = `- [ ] Stretch 🔁 every day 📅 ${TODAY}`
    disk.set('/n/Plan.md', `${line}\n`)
    const row = taskRow('Plan.md', line)
    await Promise.all([tickRows([row], TODAY), tickRows([row], TODAY), tickRows([row], TODAY)])
    expect(lines()).toHaveLength(2)
  })
})
