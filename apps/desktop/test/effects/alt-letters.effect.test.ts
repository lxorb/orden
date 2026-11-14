import { flushSync } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as string[])

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../../src/lib/tab-strip/letters.svelte', () => ({
  essentialLetters: {
    given: { '/space/Notes.md': 'N' },
    pathOf: (letter: string) => (letter === 'N' ? '/space/Notes.md' : null),
  },
}))
vi.mock('../../src/lib/essentials.svelte', () => ({
  openEssential: (path: string) => void opened.push(path),
}))

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    onfinish: null,
  }) as unknown as Animation

if (typeof globalThis.CSS === 'undefined') {
  vi.stubGlobal('CSS', { escape: (text: string) => text })
}

const { numbers } = await import('../../src/lib/tab-strip/numbers.svelte')
const { replay } = await import('../../src/lib/web-tab/keys')
const { workspace } = await import('../../src/lib/workspace.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

const NAMES = ['a', 'b']

beforeAll(() => {
  const pane = workspace.panes.focusedId
  workspace.tabs = NAMES.map((id) => ({ id, paneId: pane }) as unknown as Tab)
  const strip = document.createElement('div')
  strip.dataset.strip = pane
  for (const id of NAMES) {
    strip.insertAdjacentHTML(
      'beforeend',
      `<div class="tab"><button class="pick" data-tab="${id}"><span class="face"></span></button></div>`,
    )
  }
  document.body.append(strip)
  strip.insertAdjacentHTML('afterend', '<button class="tile" data-essential-letter="N"></button>')

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const tab = this.closest<HTMLElement>('.pick')?.dataset.tab
    if (tab) return DOMRect.fromRect({ x: NAMES.indexOf(tab) * 100, y: 0, width: 24, height: 24 })
    if (this.matches('.tile')) return DOMRect.fromRect({ x: 10, y: 100, width: 30, height: 30 })
    return DOMRect.fromRect({ x: -10_000, y: 0, width: 20_000, height: 24 })
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => [DOMRect.fromRect()] as unknown as DOMRectList,
  )
})

beforeEach(() => {
  opened.length = 0
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  })
})

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }))
  document.querySelector('.focus-place')?.remove()
  vi.useRealTimers()
})

const worn = () => {
  vi.advanceTimersByTime(16)
  flushSync()
  return numbers.worn.map((one) => one.label)
}

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

const PLACES = {
  note: () => {
    const editor = document.createElement('div')
    editor.className = 'cm-content'
    editor.contentEditable = 'true'
    return editor
  },
  terminal: () => {
    const screen = document.createElement('div')
    screen.className = 'xterm'
    screen.append(document.createElement('textarea'))
    return screen
  },
  'top bar': () => {
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.append(document.createElement('input'))
    return bar
  },
}

describe.each(Object.keys(PLACES) as (keyof typeof PLACES)[])(
  'with the keyboard in a %s',
  (place) => {
    function focused(): HTMLElement {
      const made = PLACES[place]()
      made.classList.add('focus-place')
      document.body.append(made)
      const field = made.querySelector<HTMLElement>('textarea, input') ?? made
      field.tabIndex = 0
      field.focus()
      return field
    }

    test('Alt shows the letters with the numbers', () => {
      const field = focused()
      press(field, { key: 'Alt', altKey: true })
      expect(worn()).toEqual(['1', '0', 'N'])
    })

    test('and Alt and the letter goes to its Essential, as Alt and a digit goes to a tab', async () => {
      const field = focused()
      press(field, { key: 'Alt', altKey: true })
      const letter = press(field, { key: 'n', code: 'KeyN', altKey: true })
      expect(letter.defaultPrevented).toBe(true)
      expect(worn()).toEqual(['1', '0', 'N'])
      vi.useRealTimers()
      await vi.waitFor(() => expect(opened).toEqual(['/space/Notes.md']))
    })
  },
)

test('with the keyboard in a web page, the Alt it tells shows the letters with the numbers', () => {
  replay({
    key: 'Alt',
    code: 'AltLeft',
    ctrl: false,
    shift: false,
    alt: true,
    repeat: false,
    down: true,
  })
  expect(worn()).toEqual(['1', '0', 'N'])
  replay({
    key: 'n',
    code: 'KeyN',
    ctrl: false,
    shift: false,
    alt: true,
    repeat: false,
    down: true,
  })
  expect(worn()).toEqual(['1', '0', 'N'])
})
