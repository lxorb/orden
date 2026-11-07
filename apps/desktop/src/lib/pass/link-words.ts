import type { LinkRow } from '@orden/pass/wire'
import { plural, t } from '../i18n.svelte'
import type { LinkLife } from './link-make'

const MINUTE = 60e3
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function lifeName(life: LinkLife): string {
  if (life === HOUR) return t('1 hour')
  if (life === DAY) return t('1 day')
  if (life === 7 * DAY) return t('1 week')
  if (life === 14 * DAY) return t('2 weeks')
  return t('30 days')
}

export function isExpired(link: Pick<LinkRow, 'expires' | 'views' | 'seen'>, now: number): boolean {
  return link.expires <= now || (link.views !== null && link.seen >= link.views)
}

export function expiresIn(expires: number, now: number): string {
  const left = expires - now
  if (left <= 0) return t('Expired')
  if (left >= DAY) {
    return plural(Math.round(left / DAY), { one: 'in {count} day', other: 'in {count} days' })
  }
  if (left >= HOUR) {
    return plural(Math.round(left / HOUR), { one: 'in {count} hour', other: 'in {count} hours' })
  }
  return plural(Math.max(1, Math.round(left / MINUTE)), {
    one: 'in {count} minute',
    other: 'in {count} minutes',
  })
}

export function viewsWord(link: Pick<LinkRow, 'views' | 'seen'>): string {
  if (link.views === null) {
    return plural(link.seen, { one: '{count} view', other: '{count} views' })
  }
  return plural(
    link.views,
    { one: '{seen} of {count} view', other: '{seen} of {count} views' },
    {
      seen: link.seen,
    },
  )
}
