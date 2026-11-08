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
  const { crashAskDue } = await import('../surfaces.svelte')
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
  const button = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === 'Continue',
  )
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

  test('turns usage data on only when ticked', async () => {
    await launch()
    const { usageChoice } = await import('../usage/choice.svelte')
    usageBox()?.click()
    flushSync()
    goOn()
    expect(usageChoice.helping).toBe(true)
    expect(localStorage.getItem(HELPING)).toBe('true')
  })

  test('leaves usage data off when left unticked', async () => {
    await launch()
    const { usageChoice } = await import('../usage/choice.svelte')
    goOn()
    expect(usageChoice.helping).toBe(false)
    expect(localStorage.getItem(HELPING)).toBeNull()
  })

  test('keeps reports on when left ticked, and does not ask again', async () => {
    const first = await launch()
    goOn()
    expect(first.crashReports.asking).toBe(false)
    expect(first.crashReports.on).toBe(true)
    expect(localStorage.getItem(SENDING)).toBe('true')
    expect(localStorage.getItem(ASKED)).toBe('true')
    close()

    const again = await launch()
    expect(again.due).toBe(false)
    expect(again.crashReports.on).toBe(true)
    expect(dialog()).toBeNull()
  })

  test('turns reports off when unticked, the same setting Settings shows, and does not ask again', async () => {
    const first = await launch()
    const tick = box()
    if (!tick) throw new Error('no checkbox')
    tick.click()
    flushSync()
    expect(tick.checked).toBe(false)
    goOn()
    expect(first.crashReports.on).toBe(false)
    expect(localStorage.getItem(SENDING)).toBe('false')
    close()

    const again = await launch()
    expect(again.due).toBe(false)
    expect(again.crashReports.on).toBe(false)
    expect(dialog()).toBeNull()
  })

  test('takes Escape as the choice shown, not as a way to skip the question', async () => {
    const first = await launch()
    box()?.click()
    flushSync()
    const { overlays } = await import('../overlays')
    expect(overlays.escape()).toBe(true)
    flushSync()
    expect(first.crashReports.asking).toBe(false)
    expect(localStorage.getItem(ASKED)).toBe('true')
    expect(localStorage.getItem(SENDING)).toBe('false')
  })

  test('is not asked of someone an older version already told about reports', async () => {
    localStorage.setItem(ASKED, 'true')
    const { due, crashReports } = await launch()
    expect(due).toBe(false)
    crashReports.ask()
    expect(crashReports.asking).toBe(false)
    expect(crashReports.on).toBe(true)
  })

  test('is not asked of someone who already chose in Settings', async () => {
    localStorage.setItem(SENDING, 'false')
    const { due, crashReports } = await launch()
    expect(due).toBe(false)
    crashReports.ask()
    expect(crashReports.asking).toBe(false)
    expect(crashReports.on).toBe(false)
  })
})
