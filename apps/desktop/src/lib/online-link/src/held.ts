import { localDate } from '../../platform/src/api'

export interface Holder {
  by: string
  since: number
  taken: boolean
}

export function heldLine(holder: Holder, now = Date.now()): string {
  const device = holder.by || 'another device'
  if (holder.taken) return `Taken over by ${device}`
  const day = (at: number) => localDate(at, { dateStyle: 'short' })
  const today = day(holder.since) === day(now)
  const time = localDate(
    holder.since,
    today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
  )
  return `Open on ${device} since ${time}`
}
