import { describe, expect, test } from 'vitest'
import type { Lane } from './records'
import { GAP, type Place, siteOf, Tracker, WRITE_EVERY } from './tracker'

interface Written {
  id: string
  lane: Lane
  key: string
  start: number
  end: number
}

function tracked() {
  const spans: Written[] = []
  const tracker = new Tracker({
    opened: (lane, place, start, end) => {
      const id = `s${spans.length}`
      spans.push({ id, lane, key: place.key, start, end })
      return id
    },
    moved: (id, end) => {
      const span = spans.find((one) => one.id === id)
      if (span) span.end = end
      return !!span
    },
  })
  return { spans, tracker }
}

const UNI: Place = { key: 'uni', name: 'Uni' }
const HOME: Place = { key: 'home', name: 'Home' }
const MOODLE: Place = { key: 'moodle.ethz.ch', name: 'moodle.ethz.ch' }
const FIREFOX: Place = { key: 'firefox', name: 'Firefox' }

interface Looked {
  active?: boolean
  space?: Place | null
  site?: Place | null
  app?: Place | null
}

const at = (seconds: number, change: Looked = {}) => {
  const { active = true, space = UNI, site = null, app = null } = change
  return {
    at: seconds * 1000,
    places: active ? { space, site, app } : {},
  }
}

function walk(tracker: Tracker, from: number, to: number, change: Looked = {}) {
  for (let second = from; second <= to; second += 15) tracker.seen(at(second, change))
}

const lasting = (span: Written | undefined) => (span ? (span.end - span.start) / 1000 : null)

describe('time counted by itself', () => {
  test('is one span while the same space stays in front and the person is there', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 600)
    tracker.flush()
    expect(spans).toHaveLength(1)
    expect(lasting(spans[0])).toBe(600)
  })

  test('shows at the first look after it opened, then is written at most once a minute', () => {
    const { spans, tracker } = tracked()
    const moves: number[] = []
    const counting = new Tracker({
      opened: () => 'a',
      moved: (_id, end) => moves.push(end) > 0,
    })
    walk(tracker, 0, 15)
    expect(lasting(spans[0])).toBe(15)
    walk(counting, 0, 300)
    expect(moves.length).toBeLessThanOrEqual(1 + 300_000 / WRITE_EVERY)
    counting.seen(at(315, { active: false }))
    expect(moves.at(-1)).toBe(300_000)
  })

  test('stops when the person goes, and starts again as a new span when they come back', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 120)
    walk(tracker, 135, 600, { active: false })
    walk(tracker, 615, 700)
    tracker.flush()
    expect(spans.map(lasting)).toEqual([120, 75])
  })

  test('is a new span after the machine slept, longer than the gap', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 60)
    walk(tracker, 60 + GAP / 1000 + 15, 300)
    tracker.flush()
    expect(spans).toHaveLength(2)
  })

  test('follows a switch of space, and keeps the site in its own lane', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 60, { site: MOODLE })
    walk(tracker, 75, 120, { space: HOME, site: MOODLE })
    tracker.flush()
    expect(spans.map((one) => [one.lane, one.key, lasting(one)])).toEqual([
      ['site', 'moodle.ethz.ch', 120],
      ['space', 'uni', 60],
      ['space', 'home', 45],
    ])
  })

  test('counts no site where none is in front, as for a private tab', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 60, { site: MOODLE })
    walk(tracker, 75, 120, { site: null })
    tracker.flush()
    expect(spans.filter((one) => one.lane === 'site').map(lasting)).toEqual([60])
  })

  test('keeps the app in front in a lane of its own, beside the space', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 60, { app: FIREFOX })
    walk(tracker, 75, 120, { app: null })
    tracker.flush()
    expect(spans.map((one) => [one.lane, one.key, lasting(one)])).toEqual([
      ['app', 'firefox', 60],
      ['space', 'uni', 120],
    ])
  })

  test('opens a new span when the one it was lengthening is gone', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 30)
    spans.splice(0)
    walk(tracker, 45, 200)
    tracker.flush()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.end).toBe(195_000)
  })

  test('writes nothing of a place in front for one look only, as tabs passed through', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 0, 60)
    tracker.seen(at(75, { space: HOME }))
    walk(tracker, 90, 120)
    tracker.seen(at(135, { space: HOME }))
    tracker.flush()
    expect(spans.map((one) => [one.key, lasting(one)])).toEqual([
      ['uni', 60],
      ['uni', 30],
    ])
  })

  test('starts over when the clock goes back', () => {
    const { spans, tracker } = tracked()
    walk(tracker, 600, 660)
    walk(tracker, 0, 30)
    expect(spans).toHaveLength(2)
  })
})

describe('the site of a web tab', () => {
  test('is the host of a web address, without www', () => {
    expect(siteOf('https://www.moodle.ethz.ch/course?id=3')).toBe('moodle.ethz.ch')
    expect(siteOf('http://example.org')).toBe('example.org')
  })

  test('is nothing for anything that is not a web page', () => {
    expect(siteOf('about:blank')).toBeNull()
    expect(siteOf('file:///etc/passwd')).toBeNull()
    expect(siteOf('nonsense')).toBeNull()
    expect(siteOf(undefined)).toBeNull()
  })
})
