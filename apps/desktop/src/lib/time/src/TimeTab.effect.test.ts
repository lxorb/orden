import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { time } = await import('./time.svelte')
const { length } = await import('./look')
const { midnightOf } = await import('../../platform/src/api')
const { undoToast } = await import('../../undo-toast/src/api')
const { overlays } = await import('../../ui-kit/src/api')
const TimeTab = (await import('./TimeTab.svelte')).default
const TimePanel = (await import('./TimePanel.svelte')).default
const H = 3_600_000
const M = 60_000
let target: HTMLElement
let close: (() => void) | undefined
let written = ''
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 4, 13, 15, 0))
  await time.opened({ owner: null, server: null, device: 'here' })
  for (const one of time.spans) time.removeSpan(one.id)
  for (const one of time.activities) time.removeActivity(one.id)
  target = document.createElement('div')
  document.body.append(target)
  written = ''
})
afterEach(() => {
  close?.()
  target.remove()
  undoToast.dismiss()
  vi.useRealTimers()
})
const tab = (doc = '') => ({
  doc,
  note: {
    replace: (text: string) => {
      written = text
    },
  },
})
function shown(component: unknown, props: Record<string, unknown> = {}) {
  const made = mount(component as typeof TimeTab, { target, props: props as never, intro: false })
  close = () => void unmount(made)
  flushSync()
}
const at = (hours: number) => midnightOf(Date.now()) + hours * H
const block = (id: string, start: number, end: number | null, activity: string | null) => ({
  id,
  start,
  end,
  activity,
  tags: [],
  note: '',
  source: end === null ? ('timer' as const) : ('manual' as const),
  place: null,
  label: null,
  device: null,
})
const own = () =>
  time.spans
    .filter((one) => one.source === 'manual' || one.source === 'timer')
    .map((one) => [time.activity(one.activity)?.name ?? null, one.start, one.end])
const options = () => [...document.querySelectorAll<HTMLElement>('[data-time-activities] [role="option"]')]
const option = (name: string) => options().find((one) => one.textContent.includes(name))
function pressed(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}
function typed(text: string) {
  const field = document.querySelector<HTMLInputElement>('[data-time-activities] input')
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
const button = (label: string) =>
  [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === label) ?? null
describe('the time tracker as a tab', () => {
  test('the picker makes an activity that does not exist yet and starts it at once', () => {
    time.addActivity('Work')
    shown(TimeTab, { tab: tab() })
    pressed(target.querySelector('[data-time-now] [data-time-pick]'))
    typed('Lunch')
    expect(document.querySelector('[data-time-create]')?.textContent).toContain('Create "Lunch"')
    document
      .querySelector('[data-time-activities] input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(time.activities.map((one) => one.name).sort()).toEqual(['Lunch', 'Work'])
    expect(time.running.map((one) => time.activity(one.activity)?.name)).toEqual(['Lunch'])
    pressed(target.querySelector('[data-time-now] [data-time-pick]'))
    typed('work')
    expect(document.querySelector('[data-time-create]')).toBeNull()
  })
  test('a block gets another activity from its chip, is split, merged and deleted, and undo brings each back', () => {
    const work = time.addActivity('Work')
    time.addActivity('Rest')
    time.schedule([
      { kind: 'add', span: block('a', at(9), at(11), work.id) },
      { kind: 'add', span: block('b', at(12), at(13), work.id) },
    ])
    shown(TimeTab, { tab: tab() })
    pressed(target.querySelector('[data-time-block="a"] [data-time-chip]'))
    pressed(option('Rest'))
    expect(own()[0]).toEqual(['Rest', at(9), at(11)])
    pressed(target.querySelector('[data-time-block="a"] .body'))
    expect(target.querySelector('[data-time-editor]')).not.toBeNull()
    expect(target.querySelector('[data-time-editor] .clocks [aria-label="Close"]')).toBeNull()
    expect(target.querySelector('[data-time-editor] > [aria-label="Close"]')).not.toBeNull()
    pressed(button('Split'))
    expect(own()).toEqual([
      ['Rest', at(9), at(10)],
      ['Rest', at(10), at(11)],
      ['Work', at(12), at(13)],
    ])
    pressed(button('Merge with next'))
    expect(own()).toEqual([
      ['Rest', at(9), at(10)],
      ['Rest', at(10), at(13)],
    ])
    expect(undoToast.kind).toBe('moved')
    target
      .querySelector('[data-time-tab]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))
    flushSync()
    expect(own()).toHaveLength(3)
    pressed(target.querySelector('[data-time-block="b"] .body'))
    target
      .querySelector('[data-time-block="b"] .body')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    flushSync()
    expect(own()).toHaveLength(2)
    expect(undoToast.kind).toBe('deleted')
  })
  test('active time nobody set is a Not set row one pick fills, and Untracked counts it or leaves it out', async () => {
    const work = time.addActivity('Work')
    time.schedule([{ kind: 'add', span: block('a', at(9), at(10), work.id) }])
    time.keepMinutes(
      Array.from({ length: 30 }, (_, index) => ({
        at: at(12) + index * M,
        active: 40,
        samples: 12,
        lid: null,
        locked: false,
      })),
    )
    shown(TimeTab, { tab: tab() })
    await vi.waitFor(() => {
      flushSync()
      expect(target.querySelector('[data-time-unset]')).not.toBeNull()
    })
    const bare = (text: string | undefined) => (text ?? '').replace(/\s+/g, '')
    const centre = () => bare(target.querySelector('[data-time-pie] figcaption')?.textContent)
    expect(centre()).toBe(bare(`${length(1.5 * H)}${length(H)} tracked`))
    expect(target.querySelector('[data-slice=""]')).not.toBeNull()
    pressed(target.querySelector('[data-time-untracked]'))
    expect(target.querySelector('[data-time-unset]')).toBeNull()
    expect(target.querySelector('[data-slice=""]')).toBeNull()
    expect(centre()).toBe(bare(`${length(H)}tracked`))
    expect(JSON.parse(written)).toMatchObject({ untracked: false })
    pressed(target.querySelector('[data-time-untracked]'))
    pressed(target.querySelector('[data-time-unset] button'))
    pressed(option('Work'))
    expect(own()).toEqual([
      ['Work', at(9), at(10)],
      ['Work', at(12), at(12.5)],
    ])
  })
  test('another range keeps the same page, and the pie follows it', () => {
    const work = time.addActivity('Work')
    time.schedule([
      { kind: 'add', span: block('a', at(9), at(10), work.id) },
      { kind: 'add', span: block('y', at(-15), at(-13), work.id) },
    ])
    shown(TimeTab, { tab: tab() })
    const centre = () => target.querySelector('[data-time-pie] figcaption strong')?.textContent
    expect(centre()).toBe(length(H))
    pressed([...target.querySelectorAll('[role="radio"]')].find((one) => one.textContent.trim() === 'Month'))
    expect(target.querySelector('[data-time-pie]')).not.toBeNull()
    expect(centre()).toBe(length(3 * H))
    expect(target.querySelectorAll('[data-time-day]')).toHaveLength(2)
    expect(JSON.parse(written)).toMatchObject({ range: 'month' })
  })
})
test('blocks pick like todos: Ctrl adds one, Shift takes a run, and Delete takes them all in one step', async () => {
  const work = time.addActivity('Work')
  time.schedule([
    { kind: 'add', span: block('a', at(8), at(9), work.id) },
    { kind: 'add', span: block('b', at(9), at(10), work.id) },
    { kind: 'add', span: block('c', at(10), at(11), work.id) },
  ])
  shown(TimeTab, { tab: tab() })
  const body = (id: string) => target.querySelector(`[data-time-block="${id}"] .body`)
  const click = (id: string, change: MouseEventInit = {}) => {
    body(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...change }))
    flushSync()
  }
  const on = () =>
    [...target.querySelectorAll('[data-time-block].on')].map((one) => one.getAttribute('data-time-block'))
  click('a')
  expect(on()).toEqual(['a'])
  expect(target.querySelector('[data-time-editor]')).not.toBeNull()
  click('c', { ctrlKey: true })
  expect(on()).toEqual(['a', 'c'])
  await vi.waitFor(() => expect(target.querySelector('[data-time-editor]')).toBeNull())
  click('a')
  click('c', { shiftKey: true })
  expect(on()).toEqual(['a', 'b', 'c'])
  body('c')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
  flushSync()
  expect(own()).toEqual([])
  target
    .querySelector('[data-time-tab]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))
  flushSync()
  expect(own()).toHaveLength(3)
})
test('the picker’s button closes the picker when pressed again', async () => {
  time.addActivity('Work')
  shown(TimeTab, { tab: tab() })
  const pick = target.querySelector('[data-time-now] [data-time-pick]')
  pressed(pick)
  expect(document.querySelector('[data-time-activities]')).not.toBeNull()
  pressed(pick)
  await vi.waitFor(() => expect(document.querySelector('[data-time-activities]')).toBeNull())
})
test('each place row shows its name between its icon and its time', () => {
  for (const [index, key] of ['orden', 'Code', 'xterm'].entries()) {
    time.addSpan({ start: at(9 + index), end: at(9.5 + index), source: 'app', place: key, label: key })
  }
  shown(TimeTab, { tab: tab() })
  const rows = [...target.querySelectorAll('[data-time-lane="app"] button.place')]
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    const parts = [...row.children].map((one) => one.className)
    const name = row.querySelector('.name')
    expect(name?.textContent.trim()).not.toBe('')
    expect(parts.findIndex((one) => one.includes('orden-row-label'))).toBe(1)
    expect(parts.at(-1)).toContain('spent')
    expect(parts.filter((one) => one.includes('fill'))).toEqual([])
  }
  expect(rows.map((one) => one.querySelector('.name')?.textContent.trim())).toEqual([
    'Orden',
    'Visual Studio Code',
    'Xterm',
  ])
})
test('a slice and its row light each other, and the pie’s centre tells that activity until the pointer leaves or a press lands elsewhere', () => {
  const work = time.addActivity('Work')
  const uni = time.addActivity('Uni')
  time.schedule([
    { kind: 'add', span: block('a', at(9), at(11), work.id) },
    { kind: 'add', span: block('b', at(12), at(13), uni.id) },
  ])
  shown(TimeTab, { tab: tab() })
  const centre = () => target.querySelector('[data-time-pie] figcaption')?.textContent.replace(/\s+/g, '')
  const arc = (id: string) => target.querySelector(`[data-arc="${id}"]`)
  const row = (id: string) => target.querySelector(`[data-slice="${id}"]`)
  const fire = (element: Element | null, type: string) => {
    element?.dispatchEvent(new MouseEvent(type, { bubbles: type === 'click' }))
    flushSync()
  }
  expect(centre()).toBe(`${length(3 * H)}tracked`.replace(/\s+/g, ''))
  fire(row(uni.id), 'mouseenter')
  expect(centre()).toBe(`${length(H)}Uni`.replace(/\s+/g, ''))
  expect(arc(uni.id)?.classList.contains('lit')).toBe(true)
  expect(arc(work.id)?.classList.contains('dim')).toBe(true)
  fire(row(uni.id), 'mouseleave')
  expect(centre()).toBe(`${length(3 * H)}tracked`.replace(/\s+/g, ''))
  expect(arc(work.id)?.classList.contains('dim')).toBe(false)
  fire(arc(work.id), 'mouseenter')
  expect(row(work.id)?.classList.contains('is-on')).toBe(true)
  expect(row(uni.id)?.classList.contains('dim')).toBe(true)
  fire(arc(work.id), 'mouseleave')
  fire(arc(work.id), 'click')
  expect(centre()).toBe(`${length(2 * H)}Work`.replace(/\s+/g, ''))
  overlays.pressed({ target: document.body })
  flushSync()
  expect(centre()).toBe(`${length(3 * H)}tracked`.replace(/\s+/g, ''))
})
describe('the time tracker beside the notes', () => {
  test('shows the activity running and today’s tracked total, and nothing else', () => {
    const work = time.addActivity('Work')
    time.schedule([{ kind: 'add', span: block('a', at(9), at(11), work.id) }])
    shown(TimePanel)
    expect(target.querySelector('[data-time-today]')?.textContent).toContain(length(2 * H))
    expect(target.textContent).toContain('Not tracking')
    expect(target.querySelector('.orden-section')).toBeNull()
  })
})
