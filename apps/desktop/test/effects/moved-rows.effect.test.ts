import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A note moved on the real workspace, with the rows of the space following it: what
 *  Today, Upcoming and a base read a task's line from. In the effects project, because
 *  the rows are told the spaces by an effect. The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../../src/lib/workspace.svelte')
const { links } = await import('../../src/lib/link-index.svelte')
const { startup } = await import('../../src/lib/startup.svelte')

const ROOT = '/space'

test('a note moved to another folder, its own relative link rewritten, keeps the rows of its words', async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.files.set(`${ROOT}/Work/Plan.md`, '- [ ] Read [spec](Spec.md)\n')
  one.files.set(`${ROOT}/Work/Spec.md`, '# Spec\n')
  one.folders.add(`${ROOT}/Work`)
  one.folders.add(`${ROOT}/Archive`)

  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  await workspace.loadTree()
  void startup.shown()
  await links.build(ROOT)
  // This disk answers no scan, so the index hears of the notes the way it hears of a
  // note written.
  for (const [path, words] of one.files) links.noteSaved(path, words)

  const { rows } = await import('../../src/lib/rows/rows.svelte')
  flushSync()
  const tasks = () =>
    rows
      .of()
      .filter((row) => row.kind === 'task')
      .map((row) => `${row.path}: ${row.task?.text ?? ''}`)
  await vi.waitFor(() => expect(tasks()).toEqual(['Work/Plan.md: Read [spec](Spec.md)']))

  await workspace.move(`${ROOT}/Work/Plan.md`, `${ROOT}/Archive`)
  await workspace.writesSettled()

  // The rewrite said its save at the new path before the move was told, and the move
  // then carried the old words' rows over it: the task kept a line the note no longer
  // has, and ticking it from Today found nothing to tick.
  expect(one.files.get(`${ROOT}/Archive/Plan.md`)).toBe('- [ ] Read [spec](../Work/Spec.md)\n')
  expect(tasks()).toEqual(['Archive/Plan.md: Read [spec](../Work/Spec.md)'])

  // The undo is the same move the other way round, and the same order.
  await workspace.undoFileAction()
  await workspace.writesSettled()
  expect(one.files.get(`${ROOT}/Work/Plan.md`)).toBe('- [ ] Read [spec](Spec.md)\n')
  expect(tasks()).toEqual(['Work/Plan.md: Read [spec](Spec.md)'])
})
