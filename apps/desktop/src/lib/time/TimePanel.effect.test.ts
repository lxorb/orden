import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const { time } = await import('./time.svelte')
const TimePanel = (await import('./TimePanel.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(async () => {
  await time.opened({ owner: null, server: null, device: 'here' })
  for (const one of time.spans) time.removeSpan(one.id)
  for (const one of time.activities) time.removeActivity(one.id)
  for (const one of time.rules) {
    time.countAs(one.space ? 'space' : 'site', one.space ?? one.site ?? '', null)
  }
  target = document.createElement('div')
  document.body.append(target)
  const shown = mount(TimePanel, { target, intro: false })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close?.()
  target.remove()
})

const button = (label: string): HTMLButtonElement => {
  const found = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === label || one.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`no ${label} button`)
  return found
}

describe('the time tracker', () => {
  test('starts a timer for an activity named there, and stops it', () => {
    button('New activity').click()
    flushSync()
    const field = target.querySelector<HTMLInputElement>('input.naming')
    if (!field) throw new Error('no field to name it in')
    field.value = 'Uni'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()

    expect(time.running.map((one) => time.activity(one.activity)?.name)).toEqual(['Uni'])
    expect(target.querySelector('.running')?.textContent).toContain('Uni')

    button('Stop timer').click()
    flushSync()
    expect(time.running).toEqual([])
    expect(target.querySelector('.running')).toBeNull()
  })

  test('shows the day’s spans, each one opening its editor', () => {
    const uni = time.addActivity('Uni', 'teal')
    const now = Date.now()
    time.addSpan({
      start: Math.max(now - 60_000, new Date(now).setHours(0, 0, 0, 0)),
      end: now,
      activity: uni.id,
    })
    flushSync()

    const rows = target.querySelectorAll('.spans li button')
    expect(rows).toHaveLength(1)
    ;(rows[0] as HTMLButtonElement).click()
    flushSync()
    expect(target.querySelector('select[aria-label="Activity"]')).not.toBeNull()
    expect(target.querySelector('.totals')?.textContent).toContain('Uni')
  })

  test('lists time found in a space apart, and counts it once a rule says what it is', () => {
    const uni = time.addActivity('Uni')
    const now = Date.now()
    const from = Math.max(now - 120_000, new Date(now).setHours(0, 0, 0, 0))
    time.addSpan({ start: from, end: now, source: 'space', space: 'k', label: 'Uni space' })
    flushSync()

    expect(target.querySelectorAll('.spans li')).toHaveLength(0)
    expect(target.textContent).toContain('Uni space')
    const sections = () =>
      [...target.querySelectorAll('.nib-section')].map((one) => one.firstChild?.textContent)
    expect(sections()).toEqual(['Spaces'])

    time.countAs('space', 'k', uni.id)
    flushSync()
    expect(sections()).toEqual(['Activity', 'Spaces'])
    expect(target.querySelector('.totals li')?.textContent).toContain('Uni')
  })

  test('adds up a week by day', () => {
    time.addActivity('Uni')
    button('Week').click()
    flushSync()
    expect(target.querySelectorAll('.days li')).toHaveLength(7)
    button('Month').click()
    flushSync()
    expect(target.querySelectorAll('.days li').length).toBeGreaterThanOrEqual(28)
    button('Day').click()
    flushSync()
    expect(target.querySelector('.title')?.hasAttribute('disabled')).toBe(true)
  })
})
