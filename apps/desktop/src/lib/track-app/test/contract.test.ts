import { describe, expect, test } from 'vitest'
import { backOf, linkIn, screenOf, specOf, TrackNav, WIDE } from '../src/api'

const DAY = new Date(2026, 10, 19).getTime()
describe('the Orden Track shell', () => {
  test('is doors and its own navigation, so loading the api draws nothing', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual([
      'TrackNav',
      'WIDE',
      'backOf',
      'linkIn',
      'loadTrackApp',
      'screenOf',
      'specOf',
    ])
    expect(WIDE).toBe(600)
  })
  test('goes back one layer at a time: a sheet, then the filter, then the screen, then out of the app', () => {
    const nav = new TrackNav()
    expect(nav.back()).toBe(false)
    nav.showDay(DAY + 3_600_000, 'uni')
    nav.settings = true
    nav.activities = true
    const seen: unknown[] = []
    while (nav.deep) {
      seen.push(backOf(nav))
      nav.back()
    }
    expect(seen).toEqual([{ activities: false }, { settings: false }, { only: null }, { screen: 'now' }])
    expect(nav.day).toBe(DAY)
    expect(nav.back()).toBe(false)
  })
  test('follows its own links to a screen, and no other app’s', () => {
    expect(screenOf('orden-track://day')).toBe('day')
    expect(screenOf('orden-track://stats/')).toBe('stats')
    expect(screenOf('orden-track://settings')).toBe(null)
    expect(screenOf('orden://day')).toBe(null)
    expect(linkIn('{"command":"","link":"orden-track://now"}')).toBe('orden-track://now')
    expect(linkIn('{"link":7}')).toBe('')
    expect(linkIn('not json')).toBe('')
  })
  test('drops the activity filter when another screen is shown', () => {
    const nav = new TrackNav()
    nav.showDay(DAY, 'uni')
    nav.show('stats')
    expect([nav.screen, nav.only]).toEqual(['stats', null])
  })
  test('opens the tracker where a time spec points: a day, a range of the stats, else today', () => {
    expect(specOf({ range: 'day', from: null, to: null, day: DAY + 5 })).toEqual({
      screen: 'day',
      day: DAY,
      range: null,
    })
    expect(specOf({ range: 'week', from: null, to: null, day: null })).toEqual({
      screen: 'stats',
      day: null,
      range: { kind: 'week' },
    })
    expect(specOf({ range: 'custom', from: DAY, to: DAY + 86_400_000 * 2, day: null }).range).toEqual({
      kind: 'custom',
      from: DAY,
      to: new Date(2026, 10, 21).getTime(),
    })
    expect(specOf({ range: 'year', from: null, to: null, day: null }).screen).toBe('day')
    const nav = new TrackNav()
    nav.open({ range: 'month', from: null, to: null, day: null })
    expect([nav.screen, nav.range]).toEqual(['stats', { kind: 'month' }])
  })
})
