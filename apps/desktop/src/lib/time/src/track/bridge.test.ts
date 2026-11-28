import { describe, expect, test } from 'vitest'
import { runAsks, trackAsks, trackSeen } from './bridge.svelte'

const WORK = { id: 'work', name: 'Work', archived: false }
const UNI = { id: 'uni', name: 'Uni', archived: false }
const OLD = { id: 'old', name: 'Old', archived: true }
const hex = (id: string) => (id === 'work' ? '#1B6ED3' : id === 'uni' ? 'var(--muted)' : '#0d7d73')
describe('what Orden Track tells the phone about its timer', () => {
  test('is the running activity with its start, the live activities most recent first, and the latest one', () => {
    expect(trackSeen({ activity: 'uni', start: 1_000 }, [UNI, OLD, WORK], hex)).toEqual({
      running: { id: 'uni', name: 'Uni', color: '#808080', since: 1_000 },
      activities: [
        { id: 'uni', name: 'Uni', color: '#808080' },
        { id: 'work', name: 'Work', color: '#1b6ed3' },
      ],
      last: 'uni',
    })
  })
  test('says nothing runs for no span or for a span with no activity, and lists at most eight', () => {
    const many = Array.from({ length: 12 }, (_, at) => ({
      id: `a${String(at)}`,
      name: `A${String(at)}`,
      archived: false,
    }))
    const seen = trackSeen({ activity: null, start: 5 }, many, hex)
    expect(seen.running).toBe(null)
    expect(seen.activities.map((one) => one.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
    expect(trackSeen(null, [], hex)).toEqual({ running: null, activities: [], last: '' })
  })
})
describe('what the phone asked of the timer while the page was away', () => {
  test('is read in the order it was pressed, and anything else is left out', () => {
    const json = JSON.stringify([
      { do: 'start', id: 'work', at: 300 },
      { do: 'stop', at: 200 },
      { do: 'start', at: 400 },
      { do: 'dance', at: 500 },
      { do: 'stop', at: 'soon' },
      null,
    ])
    expect(trackAsks(json)).toEqual([
      { do: 'stop', at: 200 },
      { do: 'start', id: 'work', at: 300 },
    ])
    expect(trackAsks('')).toEqual([])
    expect(trackAsks('{"do":"stop"}')).toEqual([])
  })
  test('is done at the moment of the press, never later than now', () => {
    const done: string[] = []
    const timer = {
      start: (id: string, at: number) => done.push(`start ${id} ${String(at)}`),
      stop: (at: number) => void done.push(`stop ${String(at)}`),
    }
    const run = runAsks(
      [
        { do: 'stop', at: 200 },
        { do: 'start', id: 'work', at: 9_000 },
      ],
      timer,
      1_000,
    )
    expect(run).toBe(2)
    expect(done).toEqual(['stop 200', 'start work 1000'])
  })
})
