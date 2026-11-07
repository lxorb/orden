import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EditorState, type EditorView } from '@orden/editor'
import FormatBar from '../../src/lib/FormatBar.svelte'
import { reactive } from './runes.svelte'

class NoLayout {
  observe() {
    // jsdom does no layout; the bar's size is never asked for here.
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
let shown: (ReturnType<typeof mount> & { follow(view: EditorView): void }) | undefined

function writing(): EditorView {
  const note = document.createElement('div')
  document.body.append(note)

  const state = EditorState.create({
    doc: 'Words to format',
    selection: { anchor: 0, head: 5 },
  })

  return {
    contentDOM: note,
    hasFocus: true,
    state,
    coordsAtPos: () => ({ left: 200, right: 240, top: 100, bottom: 120 }),
  } as unknown as EditorView
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(async () => {
  if (shown) await unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

const callout = () => target.querySelector('.orden-bar-at') !== null

test('stands over a selection, and goes when the editor under it does', () => {
  const view = writing()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  shown = mount(FormatBar, { target, props }) as typeof shown
  flushSync()

  shown?.follow(view)
  flushSync()
  expect(callout()).toBe(true)

  props.view = undefined
  flushSync()
  expect(callout()).toBe(false)
})

test('and when the window holds another editor than the one it stood over', () => {
  const view = writing()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  shown = mount(FormatBar, { target, props }) as typeof shown
  flushSync()

  shown?.follow(view)
  flushSync()

  props.view = writing()
  flushSync()
  expect(callout()).toBe(false)
})
