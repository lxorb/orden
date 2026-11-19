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
const row = (name: string) =>
  [...target.querySelectorAll('button.orden-row')].find((one) => one.textContent.includes(name)) ?? null
describe('the time tracker beside the notes', () => {
  test('with no activity yet, one is made by name, and that starts nothing and makes nothing else', () => {
    shown(TimePanel)
    expect(target.textContent).not.toContain('Nothing recorded yet')
    expect(target.querySelector('input[placeholder="What are you working on?"]')).toBeNull()
    const field = target.querySelector<HTMLInputElement>('input[aria-label="New activity"]')
    if (!field) throw new Error('no field to name an activity in')
    field.value = 'Analysis'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    button('Add').click()
    flushSync()
    expect(time.activities.map((one) => one.name)).toEqual(['Analysis'])
    expect(time.running).toEqual([])
    expect(target.querySelector('input[aria-label="New activity"]')).toBeNull()
  })
  test('starts an activity from the list, switches to another, and stops', () => {
    const analysis = time.addActivity('Analysis')
    const reading = time.addActivity('Reading')
    shown(TimePanel)
    row('Analysis')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(time.running.map((one) => one.activity)).toEqual([analysis.id])
    expect(target.textContent).toContain('Since')
    row('Reading')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(time.running.map((one) => one.activity)).toEqual([reading.id])
    button('Stop timer').click()
    flushSync()
    expect(time.running).toEqual([])
    expect(target.textContent).toContain('Recent')
    expect(target.textContent).toContain('Today')
    expect(time.activities).toHaveLength(2)
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
      lid: null,
      locked: false,
    }))
    const yesterday = minutes.map((one) => ({ ...one, at: one.at - 86_400_000 }))
    time.keepMinutes([...yesterday, ...minutes])
    await vi.waitFor(async () =>
      expect((await time.minutes(day - 86_400_000, day + 86_400_000)).length).toBeGreaterThanOrEqual(180),
    )
    shown(TimeTab, { tab: tab('{"view":"week"}') })
    await vi.waitFor(() => {
      flushSync()
      const actives = [...target.querySelectorAll('.week .head .active')].map((one) => one.textContent.trim())
      expect(actives.filter((one) => one === length(90 * 60_000)).length).toBeGreaterThanOrEqual(1)
    })
    close?.()
    shown(TimePanel)
    await vi.waitFor(() => {
      flushSync()
      expect(target.querySelector('.active')?.textContent).toContain(length(90 * 60_000))
    })
  })
})
