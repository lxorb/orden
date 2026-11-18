import { localNumber, region } from '../../../platform/src/api'
import { cityOf, type Offer, type Offers, type Refit, type ServerInfo } from './calls'

export type Sort = 'price' | 'cores' | 'memory' | 'disk' | 'name'
export type Kind = 'any' | 'shared' | 'dedicated'
export type Arch = 'any' | 'x86' | 'arm'

export interface Pick {
  offer: Offer
  monthly: number
  hourly: number
  blocked: 'disk' | 'arch' | null
  current: boolean
}

const DEFAULT_PLACES = ['nbg1', 'fsn1']

export function placeOf(offers: Offers, server: ServerInfo | null): string | null {
  if (server?.location) return server.location
  const names = offers.locations.map((one) => one.name)
  return DEFAULT_PLACES.find((one) => names.includes(one)) ?? names[0] ?? null
}

const keyOf: Record<Exclude<Sort, 'name'>, (pick: Pick) => number> = {
  price: (pick) => pick.monthly,
  cores: (pick) => pick.offer.cores,
  memory: (pick) => pick.offer.memoryGb,
  disk: (pick) => pick.offer.diskGb,
}

export function picksOf(
  offers: Offers,
  location: string | null,
  sort: Sort,
  kind: Kind,
  arch: Arch,
  server: ServerInfo | null,
): Pick[] {
  const made = server?.made ? server : null
  const archNow = made ? (offers.types.find((one) => one.name === made.type)?.arch ?? null) : null
  const picks = offers.types.flatMap((offer): Pick[] => {
    const price = offer.prices.find((one) => one.location === location)
    if (!price) return []
    if (kind !== 'any' && offer.cpu !== kind) return []
    if (arch !== 'any' && offer.arch !== arch) return []
    const blocked =
      made && offer.diskGb < made.diskGb
        ? 'disk'
        : archNow && offer.arch !== archNow
          ? 'arch'
          : null
    const { monthly, hourly } = price
    return [{ offer, monthly, hourly, blocked, current: server?.type === offer.name }]
  })
  return picks.sort((one, other) =>
    sort === 'name'
      ? one.offer.name.localeCompare(other.offer.name, 'en', { numeric: true })
      : keyOf[sort](one) - keyOf[sort](other) || one.monthly - other.monthly,
  )
}

export function money(amount: number, currency: string, hourly = false): string {
  return new Intl.NumberFormat(region(), {
    style: 'currency',
    currency,
    ...(hourly ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : {}),
  }).format(amount)
}

const gb = (value: number) => `${localNumber(Math.round(value))} GB`

const sizeOf = (one: Offer | ServerInfo) => [
  `${localNumber(one.cores)} vCPU`,
  `${gb(one.memoryGb)} RAM`,
  `${gb(one.diskGb)} disk`,
]

export function factsOf(offer: Pick['offer']): string[] {
  return [
    ...sizeOf(offer),
    offer.cpu === 'dedicated' ? 'Dedicated' : 'Shared',
    offer.arch === 'arm' ? 'Arm' : 'x86',
  ]
}

const kept = (part: string) => part.replaceAll(' ', '\u00a0')

export function summaryOf(server: ServerInfo): { about: string[]; cost: string[] } {
  const about = [
    server.type.toUpperCase(),
    ...(server.location ? [cityOf(server.location)] : []),
    ...sizeOf(server),
  ]
  const cost =
    server.price !== null && server.currency
      ? [
          `${money(server.price, server.currency)} a month`,
          ...(server.spent !== null ? [`${money(server.spent, server.currency)} this month`] : []),
        ]
      : []
  return { about: about.map(kept), cost: cost.map(kept) }
}

export function warningOf(running: number): string | null {
  if (running <= 0) return null
  return running === 1
    ? 'A terminal is running. Resizing restarts the machine, and what runs in it stops.'
    : `${localNumber(running)} terminals are running. Resizing restarts the machine, and what runs in them stops.`
}

export function askedOf(
  server: ServerInfo,
  pick: Pick,
  currency: string,
): { title: string; detail: string } {
  const disk =
    pick.offer.diskGb > server.diskGb
      ? `The disk grows from ${gb(server.diskGb)} to ${gb(pick.offer.diskGb)} and cannot shrink again; a smaller disk cannot be chosen.`
      : `The disk stays ${gb(server.diskGb)}; a smaller disk cannot be chosen.`
  const now = server.price
  const change =
    now === null
      ? `It costs ${money(pick.monthly, currency)} a month.`
      : `${money(now, currency)} a month now, ${money(pick.monthly, currency)} after: ${money(Math.abs(pick.monthly - now), currency)} ${pick.monthly >= now ? 'more' : 'less'} a month.`
  return {
    title: `Resize to ${pick.offer.name.toUpperCase()}?`,
    detail: [
      'The machine shuts down, is resized and starts again. It is away for about 5 minutes; its files and terminals stay.',
      disk,
      change,
    ].join(' '),
  }
}

export function refitWords(why: Refit): string {
  return {
    disk: 'A smaller disk cannot be chosen',
    arch: 'This machine cannot change between x86 and Arm',
    busy: 'The machine is starting; try again once it is awake',
    budget: 'That machine costs more than the budget allows',
    type: 'That machine is not offered there now',
    other: 'Could not change the machine',
  }[why]
}
