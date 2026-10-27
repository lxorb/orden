import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The join sheet's ways out (B540): a wait on the owner has Cancel and Close, and
 *  Escape and the scrim put it aside like Close rather than leaving the app behind
 *  it. Then the pill that brings a sheet put aside back.
 *
 *  In the jsdom project because the sheet is drawn and pressed. The store is stood
 *  in for: what it does with each press is joining.test.ts. */

const store = vi.hoisted(() => ({
  step: null as string | null,
  shown: true,
  aside: false,
  invitation: { from: 'Emil', space: 'Plans', note: null },
  told: '',
  busy: false,
  error: null,
  close: vi.fn(),
  cancel: vi.fn(),
  dismiss: vi.fn(),
  reopen: vi.fn(),
  tell: vi.fn(),
}))
vi.mock('./joining.svelte', () => ({ joining: store }))
vi.mock('./account.svelte', () => ({ account: { open: false } }))
vi.mock('./i18n.svelte', () => ({
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_whole, key: string) => values[key] ?? key),
}))

const { overlays } = await import('./overlays')
const JoinSheet = (await import('./JoinSheet.svelte')).default
const JoinPending = (await import('./JoinPending.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  for (const one of [store.close, store.cancel, store.dismiss, store.reopen]) one.mockClear()
  store.shown = true
  store.aside = false
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function draw(component: typeof JoinSheet, step: string) {
  store.step = step
  const shown = mount(component, { target, intro: false })
  close = () => void unmount(shown)
  flushSync()
}

function button(name: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

describe('a wait on the owner', () => {
  test('cancels from Cancel', () => {
    draw(JoinSheet, 'waiting')
    button('Cancel').click()
    expect(store.cancel).toHaveBeenCalledOnce()
  })

  test('is put aside by Close, Escape and the scrim', () => {
    draw(JoinSheet, 'waiting')
    button('Close').click()
    overlays.escape()
    target.querySelector<HTMLElement>('.scrim')?.click()

    expect(store.close).toHaveBeenCalledTimes(3)
    expect(store.dismiss).not.toHaveBeenCalled()
  })
})

test('the one field is put aside rather than thrown away', () => {
  draw(JoinSheet, 'asking')
  overlays.escape()
  target.querySelector<HTMLElement>('.scrim')?.click()

  expect(store.close).toHaveBeenCalledTimes(2)
  expect(store.dismiss).not.toHaveBeenCalled()
})

test('a line that only says something is done with on Escape', () => {
  draw(JoinSheet, 'declined')
  overlays.escape()
  expect(store.dismiss).toHaveBeenCalledOnce()
})

test('a wait put aside says so at the foot of the window, and opens again', () => {
  store.aside = true
  store.shown = false
  draw(JoinPending, 'waiting')

  button('Waiting for Emil').click()
  expect(store.reopen).toHaveBeenCalledOnce()
})
