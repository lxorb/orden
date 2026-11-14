import { describe, expect, test, vi } from 'vitest'

const { noteMenu } = await import('./note-menu')
const { picker } = await import('./export/src/picker.svelte')
const { workspace } = await import('./workspace.svelte')

const labels = (rows: readonly ({ label: string } | null)[]) =>
  rows.map((row) => (row ? row.label : '-'))

describe("a note's dots", () => {
  test('hold the rows of the app menu that are about the note, in groups', () => {
    expect(labels(noteMenu(workspace.panes.focusedId))).toEqual([
      ...['Version history', 'Export', '-'],
      ...['Read-only', 'Reading', '-'],
      ...['Source mode', 'Focus mode', 'Typewriter mode', '-'],
      ...['Fold', 'Fold everything', 'Fold more', 'Fold less', 'Unfold everything'],
    ])
  })

  test('open the one export picker when Export is pressed', async () => {
    noteMenu(workspace.panes.focusedId)
      .find((row) => row?.label === 'Export')
      ?.run()

    await vi.waitFor(() => expect(picker.open).toBe(true))
    picker.close()
  })
})
