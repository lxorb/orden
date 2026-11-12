import type { LinkRow } from '@orden/pass/wire'
import type { LinkLife } from './link-make'

const MINUTE = 60e3
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function lifeName(life: LinkLife): string {
  if (life === HOUR) return '1 hour'
  if (life === DAY) return '1 day'
  if (life === 7 * DAY) return '1 week'
  if (life === 14 * DAY) return '2 weeks'
  return '30 days'
}

export function isExpired(link: Pick<LinkRow, 'expires' | 'views' | 'seen'>, now: number): boolean {
  return link.expires <= now || (link.views !== null && link.seen >= link.views)
}

export function expiresIn(expires: number, now: number): string {
  const left = expires - now
  if (left <= 0) return 'Expired'
  if (left >= DAY) {
    return Math.round(left / DAY) === 1 ? 'in 1 day' : `in ${Math.round(left / DAY)} days`
  }
  if (left >= HOUR) {
    return Math.round(left / HOUR) === 1 ? 'in 1 hour' : `in ${Math.round(left / HOUR)} hours`
  }
  return Math.max(1, Math.round(left / MINUTE)) === 1
    ? 'in 1 minute'
    : `in ${Math.max(1, Math.round(left / MINUTE))} minutes`
}

export function viewsWord(link: Pick<LinkRow, 'views' | 'seen'>): string {
  if (link.views === null) {
    return link.seen === 1 ? '1 view' : `${link.seen} views`
  }
  return link.views === 1 ? `${link.seen} of 1 view` : `${link.seen} of ${link.views} views`
}
