import { beforeEach, describe, expect, test, vi } from 'vitest'
import { dayOf, keptOffer, OFFER_DAYS, offerDue } from './import-offer.svelte'

const KEY = 'nib:browser-import-offer'

const kept = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

async function fresh() {
  vi.resetModules()
  return (await import('./import-offer.svelte')).importOffer
}

beforeEach(() => kept.clear())

describe('when the browser import is offered', () => {
  test('a stored answer that is not ours reads as never asked', () => {
    expect(keptOffer(null)).toEqual({ days: [], done: false })
    expect(keptOffer('yes')).toEqual({ days: [], done: false })
    expect(keptOffer({ days: ['2026-11-01', 3], done: 'true' })).toEqual({
      days: ['2026-11-01'],
      done: false,
    })
  })

  test('it is asked on a few days, then no more, and never once answered', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03']
    expect(OFFER_DAYS).toBe(days.length)
    expect(offerDue({ days: [], done: false }, '2026-11-01')).toBe(true)
    expect(offerDue({ days, done: false }, '2026-11-03')).toBe(true)
    expect(offerDue({ days, done: false }, '2026-11-04')).toBe(false)
    expect(offerDue({ days: [], done: true }, '2026-11-01')).toBe(false)
  })

  test('the day is the local calendar day', () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  test('one new tab a run carries it, not every new tab', async () => {
    const offer = await fresh()
    offer.claim('one', '2026-11-01')
    offer.claim('two', '2026-11-01')
    expect(offer.tab).toBe('one')

    offer.dropped('one')
    offer.claim('two', '2026-11-01')
    expect(offer.tab).toBeNull()
  })

  test('the tab that carries it keeps it when it is moved to another pane', async () => {
    const offer = await fresh()
    offer.claim('one', '2026-11-01')
    offer.dropped('one')
    offer.claim('one', '2026-11-01')
    expect(offer.tab).toBe('one')

    offer.answered()
    offer.claim('one', '2026-11-01')
    expect(offer.tab).toBeNull()
  })

  test('a day counts only once it was shown', async () => {
    const offer = await fresh()
    offer.claim('one', '2026-11-01')
    expect(kept.has(KEY)).toBe(false)

    offer.seen('2026-11-01')
    offer.seen('2026-11-01')
    expect(keptOffer(JSON.parse(kept.get(KEY) ?? 'null')).days).toEqual(['2026-11-01'])
  })

  test('after three days shown it stays away in later runs', async () => {
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      const offer = await fresh()
      offer.claim('tab', day)
      expect(offer.tab).toBe('tab')
      offer.seen(day)
    }
    const later = await fresh()
    later.claim('tab', '2026-11-04')
    expect(later.tab).toBeNull()
  })

  test('an answer ends it for good', async () => {
    const offer = await fresh()
    offer.claim('tab', '2026-11-01')
    offer.answered()
    expect(offer.tab).toBeNull()

    const next = await fresh()
    next.claim('tab', '2026-11-02')
    expect(next.tab).toBeNull()
  })
})
