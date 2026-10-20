import { describe, expect, test } from 'vitest'

const { noteMenu } = await import('./note-menu')
const { menu } = await import('./menu.svelte')
const { exportCommands } = await import('./commands')
const { workspace } = await import('./workspace.svelte')

/** The press on the dots, as much of one as the menu reads. */
const press = {
  clientX: 4,
  clientY: 8,
  preventDefault: () => undefined,
  stopPropagation: () => undefined,
} as unknown as MouseEvent

const labels = (rows: readonly ({ label: string } | null)[]) =>
  rows.map((row) => (row ? row.label : '-'))

describe("a note's dots", () => {
  test('hold the rows of the app menu that are about the note, in groups', () => {
    expect(labels(noteMenu(press, workspace.panes.focusedId))).toEqual([
      ...['Version history', 'Export', '-'],
      ...['Read-only', 'Reading', 'Present', '-'],
      ...['Source mode', 'Focus mode', 'Typewriter mode', '-'],
      ...['Fold', 'Fold everything', 'Fold more', 'Fold less', 'Unfold everything'],
    ])
  })

  test('open the export formats in their own place when Export is pressed', () => {
    noteMenu(press, workspace.panes.focusedId)
      .find((row) => row?.label === 'Export')
      ?.run()

    expect(menu.open).toBe(true)
    expect(menu.title).toBe('Export')
    expect(labels(menu.items)).toEqual(labels(exportCommands()))
  })
})
