import { describe, expect, test } from 'vitest'
import { counted, placesOf } from './counted'
import { HOUR, piecesIn, totalsOf } from './days'
import type { Rule, Span } from './records'

const span = (id: string, start: number, end: number, change: Partial<Span> = {}): Span => ({
  id,
  start,
  end,
  activity: null,
  tags: [],
  note: '',
  source: 'manual',
  place: null,
  label: null,
  device: null,
  ...change,
})

const rule = (activity: string, lane: Rule['lane'], place: string): Rule => ({
  id: `r-${activity}-${place}`,
  activity,
  lane,
  place,
})

const SPANS = [
  span('timer', 0, HOUR, { source: 'timer', activity: 'uni' }),
  span('space', 0, 2 * HOUR, { source: 'space', place: 'uni-space', label: 'Uni' }),
  span('site', HOUR, 3 * HOUR, {
    source: 'site',
    place: 'moodle.ethz.ch',
    label: 'moodle.ethz.ch',
  }),
  span('other', 5 * HOUR, 6 * HOUR, { source: 'site', place: 'news.org', label: 'news.org' }),
]

describe('what counts towards an activity', () => {
  test('is what was recorded by hand or by the timer, and nothing found by itself', () => {
    expect(counted(SPANS, []).map((one) => one.id)).toEqual(['timer'])
  })

  test('and time in a space or on a site a rule counts as one', () => {
    const rules = [rule('uni', 'space', 'uni-space'), rule('uni', 'site', 'moodle.ethz.ch')]
    const pieces = piecesIn(counted(SPANS, rules), 0, 24 * HOUR, 24 * HOUR)
    expect(totalsOf(pieces)).toEqual([{ activity: 'uni', ms: 3 * HOUR }])
  })
})

describe('the spaces and sites time was spent in', () => {
  test('are added up per space and per site, with their names', () => {
    const pieces = piecesIn(SPANS, 0, 24 * HOUR, 24 * HOUR)
    expect(placesOf(pieces, 'space')).toEqual([
      { lane: 'space', key: 'uni-space', name: 'Uni', ms: 2 * HOUR },
    ])
    expect(placesOf(pieces, 'site').map((one) => [one.key, one.ms])).toEqual([
      ['moodle.ethz.ch', 2 * HOUR],
      ['news.org', HOUR],
    ])
  })
})
