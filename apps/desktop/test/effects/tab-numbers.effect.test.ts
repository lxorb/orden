import { flushSync } from 'svelte'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
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
const { replay } = await import('../../src/lib/ui-kit/src/api')
const { workspace } = await import('../../src/lib/workspace.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

const NAMES = ['a', 'b', 'c']

const FRAME = 16

let scrolled = 0

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

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const tab = this.closest<HTMLElement>('.pick')?.dataset.tab
    const left = tab ? NAMES.indexOf(tab) * 100 - scrolled : -10_000
    return DOMRect.fromRect({ x: left, y: 0, width: tab ? 24 : 20_000, height: 24 })
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => [DOMRect.fromRect()] as unknown as DOMRectList,
  )
})

beforeEach(() => {
  scrolled = 0
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  })
})

afterEach(() => {
  release()
  window.dispatchEvent(new Event('blur'))
  vi.useRealTimers()
})

const press = (key: string, more: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: /^\d$/.test(key) ? `Digit${key}` : key,
      bubbles: true,
      ...more,
    }),
  )

function release() {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  flushSync()
}

const worn = () => numbers.worn.map((one) => one.label)
const drawn = () => [...document.querySelectorAll('.numeral')].map((one) => one.textContent)

function wait(ms: number) {
  vi.advanceTimersByTime(ms)
  flushSync()
}

test('come in the frame Alt goes down in, one on each tab, the last wearing 0', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])
  expect(drawn()).toEqual(['1', '2', '0'])
})

test('are on screen within one frame of Alt going down, however it repeats', () => {
  const began = Date.now()
  let shown: number | null = null
  press('Alt', { altKey: true })

  for (let at = 1; at <= 200 && shown === null; at++) {
    if (at % 5 === 0) press('Alt', { altKey: true })
    wait(1)
    if (worn().length) shown = Date.now() - began
  }

  expect(shown).not.toBeNull()
  expect(shown).toBeLessThanOrEqual(FRAME)
  expect(document.querySelectorAll('.numeral')).toHaveLength(3)
})

test('stay through three digits, each put where the tabs are once its tab is in front', () => {
  const switching = (event: KeyboardEvent) => {
    if (event.altKey && /^Digit\d$/.test(event.code)) scrolled += 10
  }
  window.addEventListener('keydown', switching)

  press('Alt', { altKey: true })
  wait(FRAME)
  const first = document.querySelector('.numeral')
  expect(numbers.worn[0]?.x).toBe(24)

  for (const [at, digit] of ['2', '0', '1'].entries()) {
    press(digit, { altKey: true })
    expect(worn(), digit).toEqual(['1', '2', '0'])
    wait(FRAME)
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: digit, code: `Digit${digit}`, altKey: true }),
    )
    flushSync()
    expect(drawn(), digit).toEqual(['1', '2', '0'])
    expect(numbers.worn[0]?.x, digit).toBe(24 - 10 * (at + 1))
  }
  expect(document.querySelector('.numeral')).toBe(first)

  window.removeEventListener('keydown', switching)
  release()
  expect(worn()).toEqual([])
})

test('and go the moment Alt is let go of', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  expect(worn()).toHaveLength(3)

  release()
  expect(worn()).toEqual([])
})

test('a quick Alt+3 shows them for as long as Alt is down', () => {
  press('Alt', { altKey: true })
  press('3', { altKey: true })
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])
  release()
  expect(worn()).toEqual([])
})

test('never come for AltGr, alone or with a digit', () => {
  press('Control', { ctrlKey: true })
  press('Alt', { ctrlKey: true, altKey: true })
  press('2', { ctrlKey: true, altKey: true })
  wait(FRAME * 4)
  expect(worn()).toEqual([])
})

test('stay through Alt+F4, Alt and an arrow, Alt and Shift, the pointer and the wheel', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  for (const [at, other] of [
    () => press('F4', { altKey: true }),
    () => press('ArrowLeft', { altKey: true }),
    () => press('Shift', { altKey: true, shiftKey: true }),
    () => window.dispatchEvent(new PointerEvent('pointerdown', { altKey: true })),
    () => window.dispatchEvent(new WheelEvent('wheel', { altKey: true })),
    () => press('Alt', { altKey: true, repeat: true }),
  ].entries()) {
    other()
    wait(FRAME)
    expect(worn(), String(at)).toHaveLength(3)
  }
  release()
  expect(worn()).toEqual([])
})

test('go at Alt let go of, at a key or the pointer saying it is up, and the window going', () => {
  for (const [at, end] of [
    () => release(),
    () => press('a', { code: 'KeyA' }),
    () => window.dispatchEvent(new PointerEvent('pointermove')),
    () => window.dispatchEvent(new WheelEvent('wheel')),
    () => window.dispatchEvent(new FocusEvent('blur')),
  ].entries()) {
    release()
    window.dispatchEvent(new FocusEvent('blur'))
    press('Alt', { altKey: true })
    wait(FRAME)
    expect(worn(), String(at)).toHaveLength(3)

    end()
    wait(FRAME)
    expect(worn(), String(at)).toEqual([])
  }
})

test("come over a web page, stay through the page's keys, go at the release it tells", () => {
  const said = (key: string, code: string, down = true) =>
    replay({ key, code, ctrl: false, shift: false, alt: true, repeat: false, down })

  said('Alt', 'AltLeft')
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])

  said('2', 'Digit2')
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])

  said('Unidentified', '')
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])

  said('Alt', 'AltLeft', false)
  flushSync()
  expect(worn()).toEqual([])
})
