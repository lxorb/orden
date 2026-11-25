import type { Env, Reached, Whoever } from '../../../sync-server/src/api'

const SEEN_EVERY = 10 * 60_000
const LONGEST_CITY = 80
interface Place {
  city: string | null
  country: string | null
}
function placeOf(cf: unknown): Place {
  const said = (cf ?? {}) as { city?: unknown; country?: unknown }
  const city = typeof said.city === 'string' ? said.city.trim().slice(0, LONGEST_CITY) : ''
  const country = typeof said.country === 'string' ? said.country.trim().toUpperCase() : ''
  return { city: city || null, country: /^[A-Z0-9]{2}$/.test(country) ? country : null }
}
export function placeText(city: string | null, country: string | null): string | null {
  return [city, country].filter(Boolean).join(', ') || null
}
export type Seer = { email: string } | { guest: string }
export async function memberSeen(
  env: Env,
  spaceId: string,
  seer: Seer,
  items: readonly string[],
  cf: unknown,
  at: number,
): Promise<void> {
  const { city, country } = placeOf(cf)
  const [table, key, value] =
    'guest' in seer ? ['guest_members', 'guest_id', seer.guest] : ['space_members', 'email', seer.email]
  await env.DB.prepare(
    `update ${table} set seen_at = ?1, seen_city = coalesce(?2, seen_city), seen_country = coalesce(?3, seen_country)
      where space_id = ?4 and ${key} = ?5 and item in (select value from json_each(?6))
        and (seen_at is null or seen_at <= ?1 - ?7)`,
  )
    .bind(at, city, country, spaceId, value, JSON.stringify(items), SEEN_EVERY)
    .run()
}
export async function spaceSeen(env: Env, who: Whoever, space: Reached, cf: unknown, at: number): Promise<void> {
  if (space.role === 'owner') return
  if (space.seen_at !== undefined && space.seen_at !== null && space.seen_at > at - SEEN_EVERY) return
  const seer = who.kind === 'user' ? { email: who.user.email } : { guest: who.guest.id }
  await memberSeen(env, space.id, seer, [''], cf, at)
}
