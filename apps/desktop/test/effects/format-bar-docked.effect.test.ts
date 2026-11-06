import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { EditorView } from '@orden/editor'
import FormatBar from '../../src/lib/FormatBar.svelte'
import { viewport } from '../../src/lib/viewport.svelte'

class NoLayout {
  observe() {
    // Said above.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

let target: HTMLElement
let note: HTMLElement
let field: HTMLInputElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  target = document.createElement('div')
  note = document.createElement('div')
  note.tabIndex = 0
  field = document.createElement('input')
  document.body.append(target, note, field)

  viewport.device = 'phone'
  viewport.typing = true
  shown = mount(FormatBar, {
    target,
    props: { view: { contentDOM: note } as EditorView },
  })
  flushSync()
})

afterEach(async () => {
  if (shown) await unmount(shown)
  shown = undefined
  viewport.device = 'desktop'
  viewport.typing = false
  document.body.replaceChildren()
})

async function settled() {
  await Promise.resolve()
  await tick()
  flushSync()
}

const docked = () => target.querySelector('.nib-bar.docked') !== null

test('docks while the note has the keyboard', async () => {
  note.focus()
  await settled()

  expect(docked()).toBe(true)
})

test('and not for another field the keys came up for', async () => {
  note.focus()
  await settled()
  field.focus()
  await settled()

  expect(docked()).toBe(false)
})
