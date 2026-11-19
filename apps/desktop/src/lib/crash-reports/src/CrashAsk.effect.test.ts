import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const SENDING = 'orden:crash-reports'
const ASKED = 'orden:crash-reports-told'
const HELPING = 'orden:usage-help'

let target: HTMLElement
let shown: Record<string, unknown> | null = null
let svelte: typeof import('svelte')

const flushSync = () => svelte.flushSync()

async function launch() {
  vi.resetModules()
  svelte = await import('svelte')
  const { crashAskDue } = await import('../../surfaces/src/api')
  const { crashReports } = await import('./choice.svelte')
  const due = crashAskDue()
  if (due) {
    const CrashAsk = (await import('./CrashAsk.svelte')).default
    shown = svelte.mount(CrashAsk, { target, intro: false })
    flushSync()
  }
  return { due, crashReports }
}

const dialog = () => target.querySelector<HTMLElement>('[role="dialog"]')
const box = () => target.querySelector<HTMLInputElement>('input[type="checkbox"]')
const usageBox = () => target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]

function goOn() {
  const button = [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Continue')
  if (!button) throw new Error('no Continue')
  button.click()
  flushSync()
}

function close() {
  if (shown) void svelte.unmount(shown)
  shown = null
  target.replaceChildren()
}

beforeEach(() => {
  localStorage.clear()
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close()
  target.remove()
})

describe('the crash report question', () => {
  test('is asked the first time Orden opens, crash reports ticked and usage data not, with one button', async () => {
    const { due, crashReports } = await launch()
    expect(due).toBe(true)
    expect(crashReports.asking).toBe(true)
    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(box()?.checked).toBe(true)
    expect(usageBox()?.checked).toBe(false)
    expect(dialog()?.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Send crash reports to help improve Orden Also share anonymous usage data Continue',
    )
  })

  test.each([
    [true, 'true'],
    [false, null],
  ])('turns usage data on only when ticked (%s)', async (ticked, kept) => {
    await launch()
    const { usageChoice } = await import('../../usage/src/api')
    if (ticked) usageBox()?.click()
    flushSync()
    goOn()
    expect(usageChoice.helping).toBe(ticked)
    expect(localStorage.getItem(HELPING)).toBe(kept)
  })

  test.each([true, false])(
    'keeps reports as ticked (%s), the same setting Settings shows, and does not ask again',
    async (ticked) => {
      const first = await launch()
      if (!ticked) box()?.click()
      flushSync()
      expect(box()?.checked).toBe(ticked)
      goOn()
      expect(first.crashReports.asking).toBe(false)
      expect(first.crashReports.on).toBe(ticked)
      expect(localStorage.getItem(SENDING)).toBe(String(ticked))
      expect(localStorage.getItem(ASKED)).toBe('true')
      close()

      const again = await launch()
      expect(again.due).toBe(false)
      expect(again.crashReports.on).toBe(ticked)
      expect(dialog()).toBeNull()
    },
  )

  test('takes Escape as the choice shown, not as a way to skip the question', async () => {
    const first = await launch()
    box()?.click()
    flushSync()
    const { overlays } = await import('../../ui-kit/src/overlays')
    expect(overlays.escape()).toBe(true)
    flushSync()
    expect(first.crashReports.asking).toBe(false)
    expect(localStorage.getItem(ASKED)).toBe('true')
    expect(localStorage.getItem(SENDING)).toBe('false')
  })

  test.each([
    [ASKED, 'true', true],
    [SENDING, 'false', false],
  ])('is not asked of someone already told or who chose in Settings (%s)', async (key, value, on) => {
    localStorage.setItem(key, value)
    const { due, crashReports } = await launch()
    expect(due).toBe(false)
    crashReports.ask()
    expect(crashReports.asking).toBe(false)
    expect(crashReports.on).toBe(on)
  })
})
