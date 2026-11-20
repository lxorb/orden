import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { time } = await import('./time.svelte')
const { length } = await import('./look')
const { dayTotals } = await import('./schedule')
const { localDate, midnightOf } = await import('../../platform/src/api')
const { menu } = await import('../../ui-kit/src/api')
const TimePanel = (await import('./TimePanel.svelte')).default
const TimeTab = (await import('./TimeTab.svelte')).default
const H = 3_600_000
const M = 60_000
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
  menu.hide()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function shown(component: unknown, props: Record<string, unknown> = {}) {
  const made = mount(component as typeof TimePanel, { target, props: props as never, intro: false })
  close = () => void unmount(made)
  flushSync()
}
const tab = (doc = '') => ({ doc, note: { replace: () => undefined } })
const button = (label: string, within: ParentNode = target): HTMLButtonElement => {
  const found = [...within.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === label || one.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`no ${label} button`)
  return found
}
const options = () => [...document.querySelectorAll<HTMLElement>('[data-time-activities] [role="option"]')]
const option = (name: string) => options().find((one) => one.textContent.includes(name))
function typed(field: HTMLInputElement | null, text: string) {
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
function pressed(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}
const at = (hours: number) => midnightOf(Date.now()) + hours * H
describe('the activity picker', () => {
  test('starts an activity, switches to another, finds by typing and never makes one, and opens the activities', () => {
    const analysis = time.addActivity('Analysis')
    const reading = time.addActivity('Reading')
    shown(TimePanel)
    expect(target.textContent).not.toContain('Nothing recorded yet')
    expect(target.querySelector('input[placeholder="What are you working on?"]')).toBeNull()
    pressed(target.querySelector('[data-time-pick]'))
    typed(document.querySelector('[data-time-activities] input'), 'rea')
    expect(options().map((one) => one.textContent.trim())).toEqual(['Reading'])
    typed(document.querySelector('[data-time-activities] input'), 'Lunch')
    document
      .querySelector('[data-time-activities] input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(time.activities).toHaveLength(2)
    expect(time.running).toEqual([])
    typed(document.querySelector('[data-time-activities] input'), '')
    pressed(option('Analysis'))
    expect(time.running.map((one) => one.activity)).toEqual([analysis.id])
    expect(target.querySelector('[role="timer"]')).not.toBeNull()
    expect(target.textContent).not.toContain('Since')
    vi.setSystemTime(new Date(2026, 4, 13, 15, 30))
    pressed(target.querySelector('[data-time-pick]'))
    pressed(option('Reading'))
    expect(time.running.map((one) => one.activity)).toEqual([reading.id])
    expect(time.spans.filter((one) => one.activity === analysis.id).map((one) => one.end)).toEqual([at(15.5)])
    pressed(target.querySelector('[data-time-pick]'))
    pressed(button('Manage activities', document.body))
    expect(document.querySelector('[role="dialog"][aria-label="Activities"]')).not.toBeNull()
    button('Stop timer').click()
    flushSync()
    expect(time.running).toEqual([])
  })
  test('the sidebar starts a recent activity, and shows today’s schedule and active time', async () => {
    const uni = time.addActivity('Uni')
    time.schedule([
      {
        kind: 'add',
        span: { ...blockSpan('done', at(9), at(11), uni.id) },
      },
    ])
    time.keepMinutes(minutesOf(at(9), 90))
    shown(TimePanel)
    await vi.waitFor(() => {
      flushSync()
      expect(target.querySelector('[data-time-active]')?.textContent).toBe(length(90 * M))
    })
    expect(target.querySelector('[data-time-today]')?.textContent).toBe(length(2 * H))
    expect(target.querySelector('[data-time-strip] .bar span')).not.toBeNull()
    pressed(target.querySelector(`[data-activity="${uni.id}"]`))
    expect(time.running.map((one) => one.activity)).toEqual([uni.id])
    expect(target.textContent).not.toContain('in front')
  })
})
function blockSpan(id: string, start: number, end: number | null, activity: string | null) {
  return {
    id,
    start,
    end,
    activity,
    tags: [],
    note: '',
    source: 'manual' as const,
    place: null,
    label: null,
    device: null,
  }
}
function minutesOf(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    at: from + index * M,
    active: 60,
    samples: 12,
    lid: null,
    locked: false,
  }))
}
describe('the activities sheet', () => {
  test('makes, renames and archives activities, and nothing else makes one', () => {
    shown(TimeTab, { tab: tab() })
    button('Activities').click()
    flushSync()
    const sheet = document.querySelector('[role="dialog"][aria-label="Activities"]')
    if (!sheet) throw new Error('no sheet')
    const fresh = sheet.querySelector<HTMLInputElement>('input[aria-label="New activity"]')
    typed(fresh, 'Eating')
    fresh?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(time.activities.map((one) => one.name)).toEqual(['Eating'])
    const name = sheet.querySelector<HTMLInputElement>('input[aria-label="Name"]')
    if (!name) throw new Error('no name')
    name.value = 'Lunch'
    name.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(time.activities.map((one) => one.name)).toEqual(['Lunch'])
    const [lunch] = time.activities
    time.changeActivity(lunch?.id ?? '', { archived: true })
    flushSync()
    expect(sheet.textContent).toContain('Archived')
  })
})
describe('the day as a schedule', () => {
  const BOX = { left: 0, right: 1000, top: 0, bottom: 56, x: 0, y: 0, width: 1000, height: 56 }
  function laidOut() {
    Element.prototype.setPointerCapture = () => undefined
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ ...BOX, toJSON: () => BOX }))
  }
  const track = () => target.querySelector<HTMLElement>('[data-time-schedule]')
  const x = (hours: number) => ((hours - 8) / 10) * 1000
  function drag(from: Element | null | undefined, start: number, end: number) {
    const fire = (type: string, hours: number) =>
      (type === 'pointerdown' ? from : track())?.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x(hours) }),
      )
    fire('pointerdown', start)
    fire('pointermove', (start + end) / 2)
    fire('pointermove', end)
    fire('pointerup', end)
    flushSync()
  }
  const own = () =>
    time.spans
      .filter((one) => one.source === 'manual' || one.source === 'timer')
      .map((one) => [time.activity(one.activity)?.name ?? null, one.start, one.end])
  test('drawn on empty time a block asks for its activity, and Escape leaves nothing', () => {
    laidOut()
    time.addActivity('Work')
    shown(TimeTab, { tab: tab() })
    drag(track(), 9, 10)
    document
      .querySelector('[data-time-activities] input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flushSync()
    expect(own()).toEqual([])
    drag(track(), 9, 10)
    pressed(option('Work'))
    expect(own()).toEqual([['Work', at(9), at(10)]])
  })
  test('a block is moved, resized, given another activity and deleted, and covers what it lands on', () => {
    laidOut()
    const work = time.addActivity('Work')
    const eat = time.addActivity('Eating')
    time.schedule([
      { kind: 'add', span: blockSpan('w', at(9), at(11), work.id) },
      { kind: 'add', span: blockSpan('e', at(12), at(13), eat.id) },
    ])
    shown(TimeTab, { tab: tab() })
    drag(target.querySelector('[data-block="e"]'), 12.5, 10.5)
    expect(own()).toEqual([
      ['Work', at(9), at(10)],
      ['Eating', at(10), at(11)],
    ])
    drag(target.querySelector('[data-block="e"] [data-edge="end"]'), 11, 12)
    expect(own().at(-1)).toEqual(['Eating', at(10), at(12)])
    const block = target.querySelector('[data-block="e"]')
    block?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x(11) }))
    flushSync()
    expect(menu.items.map((one) => (one && 'label' in one ? one.label : null))).toContain('Change activity')
    const change = menu.items.find((one) => one && 'label' in one && one.label === 'Change activity')
    if (change && 'run' in change) change.run()
    flushSync()
    pressed(option('Work'))
    expect(own().at(-1)).toEqual(['Work', at(10), at(12)])
    drag(target.querySelector('[data-block="e"]'), 11, 11)
    track()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    flushSync()
    expect(own()).toEqual([['Work', at(9), at(10)]])
  })
  test('active time nobody set shows as Not set, and one pick fills it', async () => {
    vi.setSystemTime(new Date(2026, 4, 20, 15, 0))
    laidOut()
    time.addActivity('Eating')
    time.keepMinutes(minutesOf(at(12), 30))
    shown(TimeTab, { tab: tab() })
    await vi.waitFor(() => {
      flushSync()
      expect(target.querySelector('[data-unset]')).not.toBeNull()
    })
    pressed(target.querySelector('[data-unset]'))
    pressed(option('Eating'))
    expect(own()).toEqual([['Eating', at(12), at(12.5)]])
    expect(target.querySelector('[data-unset]')).toBeNull()
  })
  test('the pie and the hours beside it are the day’s numbers', () => {
    const work = time.addActivity('Work')
    const uni = time.addActivity('Uni')
    time.schedule([
      { kind: 'add', span: blockSpan('w', at(9), at(12), work.id) },
      { kind: 'add', span: blockSpan('u', at(13), at(14), uni.id) },
    ])
    time.start(work.id, at(14.5))
    shown(TimeTab, { tab: tab() })
    const totals = dayTotals(time.spans, at(0), Date.now())
    expect(totals.ms).toBe(4.5 * H)
    expect(target.querySelector('[data-time-pie] figcaption')?.textContent).toBe(length(totals.ms))
    const bare = (text: string) => text.replace(/\s+/g, '')
    const rows = [...target.querySelectorAll('[data-slice]')].map((one) => bare(one.textContent))
    expect(rows).toEqual([bare(`Work${length(3.5 * H)}78%`), bare(`Uni${length(H)}22%`)])
  })
})
describe('the time tracker as a tab', () => {
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
  test('the week shows each day’s schedule and active time, and the hours per activity; Reports is the week now', async () => {
    const uni = time.addActivity('Uni')
    time.setGoal(uni.id, 'week', 10 * H)
    time.schedule([{ kind: 'add', span: blockSpan('u', at(9), at(11), uni.id) }])
    time.keepMinutes(minutesOf(at(9), 90))
    shown(TimeTab, { tab: tab('{"view":"reports","day":null}') })
    expect(target.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('Week')
    expect(target.querySelectorAll('.week .column')).toHaveLength(7)
    await vi.waitFor(() => {
      flushSync()
      const today = target.querySelector(`.week .head[data-day="${at(0)}"]`)
      expect(today?.querySelector('.active')?.textContent).toBe(`${length(90 * M)} active`)
    })
    expect(target.querySelector('[data-time-week]')?.textContent).toContain(`${length(2 * H)} / ${length(10 * H)}`)
    expect(target.textContent).not.toContain('Daily average')
  })
})
