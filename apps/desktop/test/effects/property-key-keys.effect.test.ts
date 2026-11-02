/** A property's key, from the keyboard.
 *
 *  Found in the #419 bug hunt (#523): Rename and Remove for a text-valued property were
 *  the pointer's alone. Shift+F10 in the value's field is the field's own menu, and the
 *  key was a span nothing could stand on, renamed by a double click. The key is a button
 *  now: Enter, Space or F2 renames it - the pointer's single click still does nothing and
 *  its double click still renames - its menu key is the row's menu, and the keyboard comes
 *  back to it once the name is typed.
 *
 *  In the jsdom project because the panel is mounted and pressed. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// jsdom has no `CSS`; the panel finds a row by its key with `CSS.escape`, and the keys
// here need no escaping.
if (typeof globalThis.CSS === 'undefined') {
  vi.stubGlobal('CSS', { escape: (text: string) => text })
}

vi.mock('../../src/lib/rooms.svelte', () => ({ rooms: { present: {}, following: null } }))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { menu } = await import('../../src/lib/menu.svelte')
const PropertiesPanel = (await import('../../src/lib/PropertiesPanel.svelte')).default

let host: HTMLElement
let shown: ReturnType<typeof mount>

const key = (name: string) =>
  host.querySelector<HTMLButtonElement>(`[data-key="${name}"] button.key`)

beforeEach(() => {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('Card', '---\nstatus: draft\n---\nWords.\n')
  host = document.createElement('div')
  document.body.append(host)
  shown = mount(PropertiesPanel, { target: host, props: {} })
  flushSync()
})

afterEach(() => {
  void unmount(shown)
  host.remove()
  menu.hide()
  vi.restoreAllMocks()
})

test('the key of a text value is a stop for the keyboard, and its menu is Rename and Remove', () => {
  const status = key('status')
  expect(status?.tabIndex).toBe(0)

  const show = vi.spyOn(menu, 'show')
  status?.focus()
  // What Shift+F10 and the menu key fire on whatever has the keyboard.
  status?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

  expect(show).toHaveBeenCalledOnce()
  const rows = show.mock.calls[0]?.[1].map((row) => (row && 'label' in row ? row.label : null))
  expect(rows).toEqual(['Rename', 'Remove'])
})

test('F2 renames it, and Enter hands the keyboard back to the key under its new name', async () => {
  key('status')?.focus()
  key('status')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
  flushSync()
  await vi.waitFor(() => expect(document.activeElement?.classList.contains('rename')).toBe(true))

  const field = document.activeElement as HTMLInputElement
  field.value = 'state'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()

  expect(workspace.tabs.at(-1)?.note.latest).toContain('state: draft')
  await vi.waitFor(() => expect(document.activeElement).toBe(key('state')))
})

const renamingNow = () => host.querySelector('input.rename') !== null

test('a single click leaves the key as it is, and a double click renames it', () => {
  key('status')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  flushSync()
  expect(renamingNow()).toBe(false)

  key('status')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
  flushSync()
  expect(renamingNow()).toBe(true)
})

test('Enter on it renames it', () => {
  // What Enter or Space on a button fires: a click with no clicks counted.
  key('status')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()
  expect(renamingNow()).toBe(true)
})

test('Escape leaves the name as it was, and the keyboard on it', async () => {
  key('status')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()
  await vi.waitFor(() => expect(document.activeElement?.classList.contains('rename')).toBe(true))

  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  flushSync()

  await vi.waitFor(() => expect(document.activeElement).toBe(key('status')))
})
