import type { Env } from '../../../sync-server/src/api'
import { Hetzner, type Location } from './hetzner'
import { costOf } from './hetzner-host'

interface Offer {
  name: string
  cores: number
  memoryGb: number
  diskGb: number
  cpu: 'shared' | 'dedicated'
  arch: 'x86' | 'arm'
  prices: { location: string; monthly: number; hourly: number }[]
}

export interface Offers {
  currency: string
  locations: Location[]
  types: Offer[]
}

const KEPT_FOR = 10 * 60_000

let kept: { token: string; at: number; offers: Offers } | null = null

export async function offersOf(env: Env, at: number): Promise<Offers | null> {
  const token = env.HETZNER_TOKEN
  if (!token) return null
  if (kept?.token === token && at - kept.at < KEPT_FOR) return kept.offers
  const hetzner = new Hetzner(token)
  const [types, locations, pricing] = await Promise.all([
    hetzner.serverTypes(),
    hetzner.locations(),
    hetzner.pricing(),
  ])
  const offered = types.flatMap((type): Offer[] => {
    if (type.deprecated) return []
    const prices = type.prices
      .filter((one) => !type.available.length || type.available.includes(one.location))
      .map((one) => ({ location: one.location, ...costOf(type, one.location, pricing) }))
    if (!prices.length) return []
    return [
      {
        name: type.name,
        cores: type.cores,
        memoryGb: type.memory,
        diskGb: type.disk,
        cpu: type.cpu,
        arch: type.arch,
        prices,
      },
    ]
  })
  const priced = new Set(offered.flatMap((one) => one.prices.map((price) => price.location)))
  const offers = {
    currency: pricing.currency,
    locations: locations.filter((one) => priced.has(one.name)),
    types: offered,
  }
  kept = { token, at, offers }
  return offers
}
