import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
const { shortcuts } = await import('../../shortcuts/src/shortcuts.svelte')
const { viewport } = await import('../../ui-kit/src/api')
const { tip } = await import('./tips.svelte')
const made: HTMLElement[] = []
const under = new Set<Element>()
let focused = true
const matches: (this: Element, selector: string) => boolean = Reflect.get(Element.prototype, 'matches')
const offs: (() => void)[] = []
function button(label: string, id: string | null) {
  const one = document.createElement('button')
  document.body.append(one)
  made.push(one)
  offs.push(shortcuts.tip(label, id)(one))
  return one
}
async function hover(one: HTMLElement) {
  under.add(one)
  one.dispatchEvent(new PointerEvent('pointerenter'))
  await vi.dynamicImportSettled()
  vi.advanceTimersByTime(500)
  flushSync()
}
function shown(): { label: string; keys: string[] } | null {
  const tip = document.querySelector('[role="tooltip"]')
  if (!tip) return null
  return {
    label: tip.querySelector('.label')?.textContent.trim() ?? '',
    keys: [...tip.querySelectorAll('kbd')].map((one) => one.textContent),
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  under.clear()
  focused = true
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':hover' ? under.has(this) : matches.call(this, selector)
  })
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  flushSync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  shortcuts.resetAll()
  for (const one of made.splice(0)) one.remove()
})
describe('a tooltip with a shortcut', () => {
  test('shows the name and one cap a key after a short rest, and goes when the pointer leaves', async () => {
    const back = button('Back', 'app.back')
    under.add(back)
    back.dispatchEvent(new PointerEvent('pointerenter'))
    await vi.dynamicImportSettled()
    vi.advanceTimersByTime(100)
    flushSync()
    expect(shown()).toBeNull()
    vi.advanceTimersByTime(400)
    flushSync()
    expect(shown()).toEqual({ label: 'Back', keys: ['Alt', '←'] })
    back.dispatchEvent(new PointerEvent('pointerleave'))
    expect(tip.shown).toBeNull()
  })
  test('says the key the reader chose, and only the name once the key is taken away', async () => {
    shortcuts.set('app.back', 'Mod-Shift-b')
    const back = button('Back', 'app.back')
    await hover(back)
    expect(shown()).toEqual({ label: 'Back', keys: ['Ctrl', 'Shift', 'B'] })
    back.dispatchEvent(new PointerEvent('pointerleave'))
    shortcuts.set('app.back', null)
    await hover(back)
    expect(shown()).toEqual({ label: 'Back', keys: [] })
  })
  test('names its keys to a screen reader the way ARIA writes them', () => {
    expect(button('Back', 'app.back').getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowLeft')
    expect(button('Settings', 'app.settings').getAttribute('aria-keyshortcuts')).toBe('Control+,')
    expect(button('Downloads', null).hasAttribute('aria-keyshortcuts')).toBe(false)
  })
  test('is the name alone where nothing holds a key', async () => {
    await hover(button('Downloads', null))
    expect(shown()).toEqual({ label: 'Downloads', keys: [] })
  })
  test('never shows on a touch screen', async () => {
    vi.spyOn(viewport, 'touch', 'get').mockReturnValue(true)
    await hover(button('Back', 'app.back'))
    expect(tip.shown).toBeNull()
  })
  test('leaves no listener behind once its button goes', async () => {
    const back = button('Back', 'app.back')
    offs.pop()?.()
    await hover(back)
    expect(tip.shown).toBeNull()
  })
})
describe('a tooltip that has been left', () => {
  test('never shows when the pointer was gone before the rest was over, with no leave heard', async () => {
    const back = button('Back', 'app.back')
    under.add(back)
    back.dispatchEvent(new PointerEvent('pointerenter'))
    await vi.dynamicImportSettled()
    under.delete(back)
    vi.advanceTimersByTime(500)
    expect(tip.shown).toBeNull()
  })
  test('goes when the pointer moves onto a page or terminal that swallows its events', async () => {
    const back = button('Back', 'app.back')
    await hover(back)
    expect(tip.shown?.label).toBe('Back')
    under.delete(back)
    vi.advanceTimersByTime(250)
    expect(tip.shown).toBeNull()
  })
  test.each([
    [
      'the pointer leaves the window',
      () => document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null })),
    ],
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    ['something scrolls', () => document.body.dispatchEvent(new Event('scroll'))],
    ['the wheel turns', () => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))],
  ])('goes at once when %s', async (_what, happen) => {
    await hover(button('Back', 'app.back'))
    expect(tip.shown?.label).toBe('Back')
    happen()
    expect(tip.shown).toBeNull()
  })
  test('goes when the window is hidden', async () => {
    await hover(button('Back', 'app.back'))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(tip.shown).toBeNull()
  })
  test('goes when the window loses focus without telling', async () => {
    await hover(button('Back', 'app.back'))
    focused = false
    vi.advanceTimersByTime(250)
    expect(tip.shown).toBeNull()
  })
  test('goes when its button is taken away', async () => {
    const back = button('Back', 'app.back')
    await hover(back)
    back.remove()
    vi.advanceTimersByTime(250)
    expect(tip.shown).toBeNull()
  })
  test('stays while the pointer stays, and a move inside it does not end it', async () => {
    const back = button('Back', 'app.back')
    await hover(back)
    document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: back }))
    vi.advanceTimersByTime(1000)
    expect(tip.shown?.label).toBe('Back')
  })
})
