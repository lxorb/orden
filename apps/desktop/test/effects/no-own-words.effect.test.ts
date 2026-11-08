import { EditorState, EditorView } from '@orden/editor'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import SettingsPanel from '../../src/lib/SettingsPanel.svelte'
import { showEditorMenu } from '../../src/lib/editor-menu'
import { menu } from '../../src/lib/menu.svelte'
import { modes } from '../../src/lib/modes.svelte'
import { settings } from '../../src/lib/settings.svelte'

Element.prototype.animate = () =>
  ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation
globalThis.ResizeObserver = class {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  menu.hide()
  document.body.replaceChildren()
})

function labels(): string[] {
  return menu.items.flatMap((one) => (one && 'label' in one ? [one.label] : []))
}

test('the menu over a misspelled word offers no dictionary to add it to', () => {
  if (!modes.spellcheck) modes.toggleSpellcheck()
  const view = new EditorView({
    state: EditorState.create({ doc: 'nib and Zug' }),
    parent: document.body,
  })
  view.posAtCoords = () => 1

  showEditorMenu(new MouseEvent('contextmenu', { clientX: 4, clientY: 4 }), view)

  expect(menu.open).toBe(true)
  expect(labels().length).toBeGreaterThan(0)
  expect(labels().filter((one) => /dictionary/i.test(one))).toEqual([])
  view.destroy()
})

test('Spelling in Settings keeps no list of words of its own', () => {
  settings.section = 'spelling'
  settings.listing = false
  shown = mount(SettingsPanel, { target: document.body })
  flushSync()

  const pane = document.querySelector('[role="region"][aria-label="Settings"]')
  expect(pane?.textContent).toContain('Check spelling')
  expect(pane?.textContent).not.toMatch(/Your words|Add a word/)
  expect(pane?.querySelector('input[placeholder="Add a word"]')).toBeNull()
})
