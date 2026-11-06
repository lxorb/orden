import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  focused: 'a',
  follows: true,
  carried: [] as string[],
  web: null as string | null,
  asked: [] as { command: string; args: unknown }[],
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  invoke: (command: string, args: unknown) => {
    state.asked.push({ command, args })
    return Promise.resolve(true)
  },
}))
vi.mock('./surfaces.svelte', () => ({ tabOverview: { open: false } }))
vi.mock('./workspace.svelte', () => ({
  workspace: {
    device: {
      get paneFollowsPointer() {
        return state.follows
      },
    },
    panes: {
      count: 2,
      get focusedId() {
        return state.focused
      },
      get dragging() {
        return state.carried.length ? { tabId: state.carried[0] } : null
      },
      focusToward: (toward: string) => {
        const next = toward === 'right' && state.focused === 'a' ? 'b' : null
        if (next) state.focused = next
        return next ? { id: next } : null
      },
    },
    focusPane: (id: string) => (state.focused = id),
    showing: (id: string) =>
      id === state.web ? { id: `tab-${id}`, kind: 'web' } : { kind: 'note' },
  },
}))

vi.stubGlobal('CSS', { escape: (text: string) => text })

const { followPointer, keyboardStays, movePane } = await import('./pane-moves')
followPointer()

function panes() {
  document.body.innerHTML =
    ['a', 'b']
      .map(
        (id) =>
          `<div data-pane="${id}"><button class="tab">${id}</button><div class="cm-content" contenteditable="true" tabindex="0"></div></div>`,
      )
      .join('') + '<aside><input class="search"></aside>'
}

const note = (id: string) => document.querySelector<HTMLElement>(`[data-pane="${id}"] .cm-content`)!
const tab = (id: string) => document.querySelector<HTMLElement>(`[data-pane="${id}"] .tab`)!
const over = (target: Element, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', ...init }),
  )

beforeEach(() => {
  panes()
  state.focused = 'a'
  state.follows = true
  state.carried = []
  state.web = null
  state.asked = []
  document.documentElement.removeAttribute('data-keyboard-in-page')
})

describe('Alt and a way', () => {
  test('takes the focus and the keyboard into the pane next over', () => {
    note('a').focus()
    movePane('right')
    expect(state.focused).toBe('b')
    expect(document.activeElement).toBe(note('b'))
  })

  test('into a web page, by the crate, which holds its keyboard', () => {
    state.web = 'b'
    movePane('right')
    expect(state.asked).toEqual([{ command: 'keyboard_back', args: { tab: 'tab-b' } }])
  })

  test('at the window edge moves nothing', () => {
    note('a').focus()
    movePane('left')
    expect(state.focused).toBe('a')
    expect(document.activeElement).toBe(note('a'))
  })
})

describe('the pointer over another pane', () => {
  test('makes it the active pane, and leaves the keyboard in the note being written', () => {
    note('a').focus()
    over(tab('b'))
    expect(state.focused).toBe('b')
    expect(document.activeElement).toBe(note('a'))
  })

  test('takes the keyboard along out of a pane nobody was typing in', () => {
    tab('a').focus()
    over(note('b'))
    expect(state.focused).toBe('b')
    expect(document.activeElement).toBe(note('b'))
  })

  test('leaves the keyboard in the sidebar, and in a web page', () => {
    const search = document.querySelector<HTMLElement>('.search')!
    search.focus()
    over(tab('b'))
    expect(document.activeElement).toBe(search)

    state.focused = 'a'
    document.documentElement.setAttribute('data-keyboard-in-page', '')
    expect(keyboardStays('a')).toBe(true)
  })

  test('does nothing with the setting off, a button held, a finger, or a drag', () => {
    state.follows = false
    over(tab('b'))
    state.follows = true
    over(tab('b'), { buttons: 1 })
    over(tab('b'), { pointerType: 'touch' })
    state.carried = ['x']
    over(tab('b'))
    expect(state.focused).toBe('a')
  })
})
