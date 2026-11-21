import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { elapse } from '../../../../test/effects/settle'
import DayShown from '../test/DayShown.svelte'
import { tabShown } from '../test/day-shown.svelte'
import { day } from './day.svelte'
import { todayHere } from './days'

afterEach(() => vi.useRealTimers())
test('a view keeps its day fresh only while its tab is shown, and catches up as it is shown again (#2412)', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 10, 20, 23, 58))
  day.again()
  const first = day.today
  const place = document.createElement('div')
  document.body.append(place)
  const view = mount(DayShown, { target: place })
  flushSync()
  expect(vi.getTimerCount()).toBe(1)
  tabShown.on = false
  flushSync()
  expect(vi.getTimerCount()).toBe(0)
  vi.setSystemTime(new Date(2026, 10, 21, 0, 2))
  await elapse(5 * 60_000)
  expect(day.today).toBe(first)
  tabShown.on = true
  flushSync()
  expect(day.today).toBe(todayHere())
  expect(day.today).not.toBe(first)
  expect(vi.getTimerCount()).toBe(1)
  await unmount(view)
  flushSync()
  expect(vi.getTimerCount()).toBe(0)
  place.remove()
})
