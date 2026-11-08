import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { time } = await import('./time.svelte')
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
  const field = target.querySelector<HTMLInputElement>(
    'input[placeholder="What are you working on?"]',
  )
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
    expect(target.querySelector('.days, .strip')).toBeNull()

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

    const row = [...target.querySelectorAll('button.orden-row')].find((one) =>
      one.textContent.includes('Analysis'),
    )
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
    expect(
      [...target.querySelectorAll('.lane .band')].map((one) => one.getAttribute('title') ?? ''),
    ).toContainEqual(expect.stringContaining('moodle.ethz.ch'))
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
})
