/** The toast on the page, following the real undo stack.
 *
 *  What undo-toast.test.ts cannot ask: the component reads the stack inside an effect
 *  and writes its own batch in the same breath, and an effect that depended on what it
 *  wrote would run itself for ever and stop the page. So the stack is changed here the
 *  way the workspace changes it, and the toast has to come and go with it.
 *
 *  In the jsdom project because it mounts a component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as focusing from '../../src/lib/focus'
import { said } from '../../src/lib/said.svelte'
import UndoToast from '../../src/lib/UndoToast.svelte'
import { UNDO_LINGER, undoToast } from '../../src/lib/undo-toast.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** jsdom has no animations, and the toast flies in. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let host: HTMLElement
let shown: ReturnType<typeof mount>

beforeEach(() => {
  workspace.undone.stack = [{ kind: 'rename', from: 'Old.md', to: 'Older.md' }]
  host = document.createElement('div')
  document.body.append(host)
  shown = mount(UndoToast, { target: host })
  flushSync()
})

afterEach(() => {
  void unmount(shown)
  host.remove()
  workspace.undone.stack = []
  vi.restoreAllMocks()
})

test('what was done before it was there is not offered', () => {
  expect(host.textContent).toBe('')
})

test('a delete puts it up, and Undo takes it back and puts it away', async () => {
  const undo = vi.spyOn(workspace, 'undoFileAction').mockImplementation(() => {
    workspace.undone.drop()
    return Promise.resolve()
  })

  workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
  workspace.undone.record({ kind: 'delete', path: 'B.md', content: 'b' })
  flushSync()
  expect(host.textContent).toContain('Deleted')

  host.querySelector('button')?.click()
  await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(2))
  flushSync()
  expect(workspace.undone.stack).toHaveLength(1)
  // Gone, on its way out: jsdom never finishes the fly, so the store is what is asked.
  expect(undoToast.kind).toBeNull()
})

test('the Undo row in a menu takes it away too', () => {
  workspace.undone.record({ kind: 'move', from: 'A.md', to: 'Archive/A.md' })
  flushSync()
  expect(host.textContent).toContain('Moved')

  workspace.undone.drop()
  flushSync()
  // Gone, on its way out: jsdom never finishes the fly, so the store is what is asked.
  expect(undoToast.kind).toBeNull()
})

/** #523: the toast arrived holding its words inside `role=status`, which most readers
 *  never announce; its clock did not stop for the keyboard; and the keyboard fell to
 *  `body` as it went. */
describe('from the keyboard', () => {
  const card = () => host.querySelector<HTMLElement>('.toast')
  const undo = () => host.querySelector<HTMLElement>('.undo')

  test('it is said through the region that was there first, not by arriving', () => {
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()

    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(said.words).toBe('Deleted. Undo')
  })

  test('each action that joins it is said again, though the words are the same', async () => {
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()
    await vi.waitFor(() => expect(said.words).toBe('Deleted. Undo'))

    workspace.undone.record({ kind: 'delete', path: 'B.md', content: 'b' })
    flushSync()
    // Emptied and put back, the only way a live region repeats itself.
    expect(said.words).toBe('')
    await vi.waitFor(() => expect(said.words).toBe('Deleted. Undo'))
  })

  test('the clock waits while the keyboard is on it, and starts as it leaves', () => {
    vi.useFakeTimers()
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()

    undo()?.focus()
    flushSync()
    vi.advanceTimersByTime(UNDO_LINGER * 2)
    expect(undoToast.kind).toBe('delete')

    undo()?.blur()
    vi.advanceTimersByTime(UNDO_LINGER)
    expect(undoToast.kind).toBeNull()
    vi.useRealTimers()
  })

  test('a pointer leaving does not start the clock under the keyboard', () => {
    vi.useFakeTimers()
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()

    undo()?.focus()
    card()?.dispatchEvent(new PointerEvent('pointerenter'))
    card()?.dispatchEvent(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(UNDO_LINGER * 2)
    expect(undoToast.kind).toBe('delete')
    vi.useRealTimers()
  })

  test('what the keyboard came from, hidden since, gives way to the note', async () => {
    const from = document.body.appendChild(document.createElement('button'))
    from.focus()
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()
    undo()?.focus()
    // Connected and able to take nothing: a side shut while the keyboard was on the card.
    from.focus = () => undefined
    const note = vi.spyOn(focusing, 'focusEditor').mockReturnValue(true)

    void unmount(shown)
    await Promise.resolve()
    expect(note).toHaveBeenCalled()

    shown = mount(UndoToast, { target: host })
    from.remove()
  })
})

test('the keyboard in it keeps it up, as the pointer on it does', () => {
  vi.useFakeTimers()
  try {
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()
    const undo = host.querySelector<HTMLButtonElement>('button.undo')
    undo?.focus()

    vi.advanceTimersByTime(UNDO_LINGER * 2)
    flushSync()
    expect(undoToast.kind).toBe('delete')

    undo?.blur()
    vi.advanceTimersByTime(UNDO_LINGER)
    flushSync()
    expect(undoToast.kind).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('Undo pressed from the keyboard leaves the keyboard in the note, not on the page', async () => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 10, 10),
  ] as unknown as DOMRectList)
  vi.spyOn(workspace, 'undoFileAction').mockImplementation(() => {
    workspace.undone.drop()
    return Promise.resolve()
  })
  const note = document.createElement('div')
  note.dataset.region = 'editor'
  note.innerHTML = '<div class="cm-content" contenteditable="true" tabindex="0"></div>'
  document.body.append(note)

  try {
    workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
    flushSync()
    const undo = host.querySelector<HTMLButtonElement>('button.undo')
    undo?.focus()
    undo?.click()
    flushSync()
    await vi.waitFor(() =>
      expect(document.activeElement?.classList.contains('cm-content')).toBe(true),
    )
  } finally {
    note.remove()
  }
})
