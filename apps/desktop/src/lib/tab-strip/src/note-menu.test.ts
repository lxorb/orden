import { providePort, registerCommands } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'

registerCommands('export.', async () => (await import('../../export/src/api')).exportRuns)
providePort('commands.app', {
  rows: async (view) => {
    const { appCommands } = await import('../../commands/src/api')
    return appCommands(view as Parameters<typeof appCommands>[0])
  },
})
const { noteMenu } = await import('./note-menu')
const { picker } = await import('../../export/src/api')
const { workspace } = await import('../../workspace/src/api')
const labels = (rows: readonly ({ label: string } | null)[]) => rows.map((row) => (row ? row.label : '-'))
describe("a note's dots", () => {
  test('hold the rows of the app menu that are about the note, in groups', async () => {
    expect(labels(await noteMenu(workspace.panes.focusedId))).toEqual([
      ...['Version history', 'Export', '-'],
      ...['Read-only', 'Reading', '-'],
      ...['Source mode', 'Focus mode', 'Typewriter mode', '-'],
      ...['Fold', 'Fold everything', 'Fold more', 'Fold less', 'Unfold everything'],
    ])
  })
  test('open the one export picker when Export is pressed', async () => {
    ;(await noteMenu(workspace.panes.focusedId)).find((row) => row?.label === 'Export')?.run()
    await vi.waitFor(() => expect(picker.open).toBe(true))
    picker.close()
  })
})
