import { describe, expect, test } from 'vitest'
import { offersOf, type Offers, refitOf, type ServerInfo } from './calls'
import { ApiError } from '../../../accounts/src/api'
import { askedOf, money, picksOf, placeOf, summaryOf, warningOf } from './choosing'

const eur = (amount: number) => money(amount, 'EUR')
const kept = (words: string) => words.replaceAll(' ', '\u00a0')

const price = (monthly: number, hourly: number, location = 'nbg1') => ({
  location,
  monthly,
  hourly,
})

const OFFERS: Offers = {
  currency: 'EUR',
  locations: [
    { name: 'fsn1', city: 'Falkenstein', country: 'DE' },
    { name: 'nbg1', city: 'Nuremberg', country: 'DE' },
    { name: 'hel1', city: 'Helsinki', country: 'FI' },
  ],
  types: [
    {
      name: 'cx53',
      cores: 16,
      memoryGb: 32,
      diskGb: 320,
      cpu: 'shared',
      arch: 'x86',
      prices: [price(27.95, 0.0486)],
    },
    {
      name: 'cx23',
      cores: 2,
      memoryGb: 4,
      diskGb: 40,
      cpu: 'shared',
      arch: 'x86',
      prices: [price(5.34, 0.0093)],
    },
    {
      name: 'cx43',
      cores: 8,
      memoryGb: 16,
      diskGb: 160,
      cpu: 'shared',
      arch: 'x86',
      prices: [price(14.27, 0.0248), price(14.27, 0.0248, 'fsn1')],
    },
    {
      name: 'cax31',
      cores: 8,
      memoryGb: 16,
      diskGb: 160,
      cpu: 'shared',
      arch: 'arm',
      prices: [price(16.05, 0.0272)],
    },
    {
      name: 'ccx33',
      cores: 8,
      memoryGb: 32,
      diskGb: 240,
      cpu: 'dedicated',
      arch: 'x86',
      prices: [price(75.47, 0.1212)],
    },
  ],
}

const SERVER: ServerInfo = {
  type: 'cx43',
  location: 'nbg1',
  cores: 8,
  memoryGb: 16,
  diskGb: 160,
  price: 14.27,
  hourly: 0.0248,
  currency: 'EUR',
  made: true,
  spent: 3.1,
}

const names = (picks: { offer: { name: string } }[]) => picks.map((one) => one.offer.name)

describe('the machines to choose from', () => {
  test('are those priced where the machine is, cheapest first, sortable by any column', () => {
    expect(names(picksOf(OFFERS, 'nbg1', 'price', 'any', 'any', null))).toEqual([
      'cx23',
      'cx43',
      'cax31',
      'cx53',
      'ccx33',
    ])
    expect(names(picksOf(OFFERS, 'fsn1', 'price', 'any', 'any', null))).toEqual(['cx43'])
    expect(names(picksOf(OFFERS, 'nbg1', 'memory', 'any', 'any', null))).toEqual([
      'cx23',
      'cx43',
      'cax31',
      'cx53',
      'ccx33',
    ])
    expect(names(picksOf(OFFERS, 'nbg1', 'name', 'any', 'any', null))).toEqual([
      'cax31',
      'ccx33',
      'cx23',
      'cx43',
      'cx53',
    ])
  })

  test('are filtered by CPU kind and architecture', () => {
    expect(names(picksOf(OFFERS, 'nbg1', 'price', 'dedicated', 'any', null))).toEqual(['ccx33'])
    expect(names(picksOf(OFFERS, 'nbg1', 'price', 'any', 'arm', null))).toEqual(['cax31'])
    expect(names(picksOf(OFFERS, 'nbg1', 'price', 'shared', 'x86', null))).toEqual([
      'cx23',
      'cx43',
      'cx53',
    ])
  })

  test('for a made machine, a smaller disk or the other architecture cannot be chosen', () => {
    const picks = picksOf(OFFERS, 'nbg1', 'price', 'any', 'any', SERVER)
    const of = (name: string) => picks.find((one) => one.offer.name === name)
    expect(of('cx23')?.blocked).toBe('disk')
    expect(of('cax31')?.blocked).toBe('arch')
    expect(of('cx43')).toMatchObject({ blocked: null, current: true })
    expect(of('cx53')?.blocked).toBeNull()
    expect(
      picksOf(OFFERS, 'nbg1', 'price', 'any', 'any', { ...SERVER, made: false })[0],
    ).toMatchObject({
      blocked: null,
    })
  })

  test('start in the machine’s own place, else Nuremberg, Falkenstein, or the first offered', () => {
    expect(placeOf(OFFERS, { ...SERVER, location: 'hel1' })).toBe('hel1')
    expect(placeOf(OFFERS, null)).toBe('nbg1')
    expect(
      placeOf({ ...OFFERS, locations: [{ name: 'ash', city: 'Ashburn', country: 'US' }] }, null),
    ).toBe('ash')
  })

  test('read from the server as sent, and nothing from a server that has none', () => {
    expect(offersOf({ currency: 'EUR', locations: OFFERS.locations, types: OFFERS.types })).toEqual(
      OFFERS,
    )
    expect(offersOf({ error: 'not found' })).toBeNull()
    expect(refitOf(new ApiError(409, 'no', { error: 'disk' }))).toBe('disk')
    expect(refitOf(new Error('offline'))).toBe('other')
  })
})

describe('resizing, asked first', () => {
  const pick = (name: string) =>
    picksOf(OFFERS, 'nbg1', 'price', 'any', 'any', SERVER).find((one) => one.offer.name === name)

  test('warns first of the terminals running, and of nothing when none are', () => {
    expect(warningOf(0)).toBeNull()
    expect(warningOf(1)).toMatch(/^A terminal is running\. Resizing restarts the machine/)
    expect(warningOf(3)).toMatch(/^3 terminals are running\./)
  })

  test('says the restart, the disk that cannot shrink, and the price difference', () => {
    const bigger = pick('cx53')
    if (!bigger) throw new Error('no cx53')
    const asked = askedOf(SERVER, bigger, 'EUR')
    expect(asked.title).toBe('Resize to CX53?')
    expect(asked.detail).toContain('starts again. It is away for about 5 minutes')
    expect(asked.detail).toContain('The disk grows from 160 GB to 320 GB and cannot shrink again')
    expect(asked.detail).toContain(
      `${eur(14.27)} a month now, ${eur(27.95)} after: ${eur(13.68)} more a month.`,
    )

    const same = pick('ccx33')
    if (!same) throw new Error('no ccx33')
    expect(askedOf({ ...SERVER, diskGb: 240 }, same, 'EUR').detail).toContain(
      'The disk stays 240 GB; a smaller disk cannot be chosen.',
    )
    expect(askedOf({ ...SERVER, price: 80 }, same, 'EUR').detail).toContain(
      `${eur(4.53)} less a month.`,
    )
  })
})

describe('the machine’s summary', () => {
  test('is its facts and its cost, laid out apart, with no dot or bullet between them', () => {
    const { about, cost } = summaryOf(SERVER)
    expect(about).toEqual([
      'CX43',
      'Nuremberg',
      '8\u00a0vCPU',
      '16\u00a0GB\u00a0RAM',
      '160\u00a0GB\u00a0disk',
    ])
    expect(cost).toEqual([kept(`${eur(14.27)} a month`), kept(`${eur(3.1)} this month`)])
    for (const part of [...about, ...cost]) expect(part).not.toMatch(/[·•‧∙⋅]/)
    expect(summaryOf({ ...SERVER, made: false, spent: null }).cost).toEqual([
      kept(`${eur(14.27)} a month`),
    ])
  })
})
