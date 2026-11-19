import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { time } = await import('./time.svelte')
const { length } = await import('./look')
const { localDate, midnightOf } = await import('../../platform/src/api')
const TimePanel = (await import('./TimePanel.svelte')).default
const TimeTab = (await import('./TimeTab.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 4, 13, 15, 0))
  await time.opened({ owner: null, server: null, device: 'here' })
  for (const one of time.spans) time.removeSpan(one.id)
  for (const one of time.activities) time.removeActivity(one.id)
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  target.remove()
  vi.useRealTimers()
})
function shown(component: unknown, props: Record<string, unknown> = {}) {
  const made = mount(component as typeof TimePanel, { target, props: props as never, intro: false })
  close = () => void unmount(made)
  flushSync()
}
const button = (label: string): HTMLButtonElement => {
  const found = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === label || one.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`no ${label} button`)
  return found
}
function typed(text: string) {
  const field = target.querySelector<HTMLInputElement>('input[placeholder="What are you working on?"]')
  if (!field) throw new Error('no field to say it in')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()
}
describe('the time tracker beside the notes', () => {
  test('opens on what to do: a field to say it in, and a few to begin with', () => {
    shown(TimePanel)
    expect(target.textContent).toContain('Nothing recorded yet')
    expect(target.querySelector('input[placeholder="What are you working on?"]')).not.toBeNull()
    for (const name of ['Work', 'Study', 'Reading', 'Break']) expect(button(name)).toBeTruthy()
    expect(target.querySelector('.strip')).not.toBeNull()
    button('Study').click()
    flushSync()
    expect(time.running.map((one) => time.activity(one.activity)?.name)).toEqual(['Study'])
    expect(target.querySelector('[role="timer"]')).not.toBeNull()
  })
  test('starts what was typed, then lists it to start again, and stops', () => {
    shown(TimePanel)
    typed('Analysis')
    expect(time.running.map((one) => time.activity(one.activity)?.name)).toEqual(['Analysis'])
    expect(target.textContent).toContain('Since')
    button('Stop timer').click()
    flushSync()
    expect(time.running).toEqual([])
    expect(target.textContent).toContain('Recent')
    expect(target.textContent).toContain('Today')
    expect(target.textContent).not.toContain('Nothing recorded yet')
    const row = [...target.querySelectorAll('button.orden-row')].find((one) => one.textContent.includes('Analysis'))
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(time.running).toHaveLength(1)
  })
})
describe('the time tracker as a tab', () => {
  const tab = (doc = '') => ({ doc, note: { replace: () => undefined } })
  test('lays the day out as what was said over what happened', () => {
    const now = Date.now()
    const study = time.addActivity('Study')
    time.addSpan({ start: now - 3_600_000, end: now - 600_000, activity: study.id })
    time.addSpan({
      start: now - 3_000_000,
      end: now - 900_000,
      source: 'site',
      place: 'moodle.ethz.ch',
      label: 'moodle.ethz.ch',
    })
    shown(TimeTab, { tab: tab() })
    expect(target.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('Day')
    expect(target.querySelector('.said .block')?.getAttribute('title')).toContain('Study')
    expect([...target.querySelectorAll('.lane .band')].map((one) => one.getAttribute('title') ?? '')).toContainEqual(
      expect.stringContaining('moodle.ethz.ch'),
    )
    expect(target.textContent).toContain('Drag across the day')
  })
  test('shows the week and the reports, and comes back to the view it was left on', () => {
    time.addActivity('Study')
    shown(TimeTab, { tab: tab('{"view":"reports","day":null}') })
    expect(target.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('Reports')
    expect(target.textContent).toContain('Daily average')
    button('Week').click()
    flushSync()
    expect(target.querySelectorAll('.week .column')).toHaveLength(7)
  })
  test('opens on today though it was left on another day, and moves on to the next day at midnight', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 4, 13, 23, 59))
    const before = new Date(2026, 4, 10).getTime()
    shown(TimeTab, { tab: tab(JSON.stringify({ view: 'day', day: before })) })
    const title = () => target.querySelector('.moving .title')?.textContent ?? ''
    expect(title()).toBe(localDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }))
    vi.setSystemTime(new Date(2026, 4, 14, 0, 1))
    vi.advanceTimersByTime(20_000)
    flushSync()
    expect(title()).toBe(localDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }))
  })
  test('shows each day’s active time, in the week and beside the notes, with nothing said', async () => {
    const day = midnightOf(Date.now())
    const minutes = Array.from({ length: 90 }, (_, index) => ({
      at: day + 9 * 3_600_000 + index * 60_000,
      active: 60,
      samples: 12,
      cpu: null,
      memory: null,
      battery: null,
      charging: null,
      lid: null,
      locked: false,
    }))
    const yesterday = minutes.map((one) => ({ ...one, at: one.at - 86_400_000 }))
    time.keepMinutes([...yesterday, ...minutes])
    await new Promise((go) => setTimeout(go, 30))
    shown(TimeTab, { tab: tab('{"view":"week"}') })
    await new Promise((go) => setTimeout(go, 30))
    flushSync()
    const actives = [...target.querySelectorAll('.week .head .active')].map((one) => one.textContent.trim())
    expect(actives.filter((one) => one === length(90 * 60_000)).length).toBeGreaterThanOrEqual(1)
    close?.()
    shown(TimePanel)
    await new Promise((go) => setTimeout(go, 30))
    flushSync()
    expect(target.querySelector('.active')?.textContent).toContain(length(90 * 60_000))
  })
})
