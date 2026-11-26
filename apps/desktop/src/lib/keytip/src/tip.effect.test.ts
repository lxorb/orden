import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
const { shortcuts } = await import('../../shortcuts/src/shortcuts.svelte')
const { viewport } = await import('../../ui-kit/src/api')
const { tip } = await import('./tips.svelte')
const made: HTMLElement[] = []
const offs: (() => void)[] = []
function button(label: string, id: string | null) {
  const one = document.createElement('button')
  document.body.append(one)
  made.push(one)
  offs.push(shortcuts.tip(label, id)(one))
  return one
}
async function hover(one: HTMLElement) {
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
