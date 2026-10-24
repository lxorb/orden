import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The scratchpad's links, which answer from the space in front and stay up to date
 *  with it. The card is built once and kept, so the notes it was handed as it came
 *  were the notes for good: a note made since, or the notes of a space switched to,
 *  were not there, `[[Plan]]` was drawn and followed as a link to nothing, and
 *  following it made an empty `Plan.md` beside the real one. In the jsdom project
 *  because the editor in the card is a real one. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'scratchpad_path') return Promise.resolve(PAD)
    if (command === 'list_spaces') return Promise.resolve([])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PAD = '/app/Scratchpad.md'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Element.prototype.scrollIntoView = () => undefined
globalThis.ResizeObserver = class {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

const { Disk } = await import('../disk')
const { noteIndex, resolveNote } = await import('../../../../packages/editor/src/wikilink/notes')
const { default: ScratchpadCard } = await import('../../src/lib/scratchpad/ScratchpadCard.svelte')
const { scratchpad } = await import('../../src/lib/scratchpad/pad')
const { links } = await import('../../src/lib/link-index.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { startup } = await import('../../src/lib/startup.svelte')

let target: HTMLElement
let undo: (() => void)[] = []

beforeEach(() => {
  disk.current = new Disk()
  disk.current.files.set(PAD, 'See [[Plan]]\n')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  for (const one of undo) one()
  undo = []
  target.remove()
})

test('the card hears of a note made after it came', async () => {
  // The index waits its turn behind the first frame; see startup.svelte.ts.
  void startup.shown()
  await links.build('/spaces/Work')
  const column = document.createElement('div')
  column.dataset.scratchpad = ''
  target.append(column)
  const made = mount(ScratchpadCard, { target: column })
  undo.push(() => void unmount(made, { outro: false }))
  await vi.waitFor(() => expect(scratchpad.live).not.toBe(null))
  flushSync()

  const held = () => scratchpad.live!.state.facet(noteIndex)
  expect(resolveNote(held(), 'Plan')).toBe(null)

  links.noteSaved('/spaces/Work/notes/Plan.md', '# Plan\n')
  flushSync()

  expect(held()).toBe(links.index(PAD))
  expect(resolveNote(held(), 'Plan')?.path).toBe('notes/Plan.md')
})
