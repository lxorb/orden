export type Saver = 'off' | 'moderate' | 'balanced' | 'maximum'

export const SAVERS: readonly Saver[] = ['off', 'moderate', 'balanced', 'maximum']

export function isSaver(value: unknown): value is Saver {
  return SAVERS.some((one) => one === value)
}

export const FROZEN_AFTER = 5 * 60_000

export const SAVING: Record<Exclude<Saver, 'off'>, { live: number; after: number }> = {
  moderate: { live: 16, after: 6 * 60 * 60_000 },
  balanced: { live: 10, after: 4 * 60 * 60_000 },
  maximum: { live: 6, after: 30 * 60_000 },
}

export interface Resting {
  id: string
  live: boolean
  onScreen: boolean
  frozen: boolean
  looked: number
  loading: boolean
  playing: boolean
  heard: number
  acting: boolean
  calling: boolean
  notifying: boolean
  edited: boolean
  inPrivate: boolean
}

export function mayFreeze(page: Resting, now: number): boolean {
  return page.live && !page.onScreen && !page.frozen && running(page, now)
}

export function mayPark(page: Resting, now: number): boolean {
  return page.live && !page.onScreen && !page.edited && !page.inPrivate && running(page, now)
}

function running(page: Resting, now: number): boolean {
  const quiet = !page.playing && now - page.heard >= FROZEN_AFTER
  return quiet && !page.loading && !page.acting && !page.calling && !page.notifying
}

export function rest(
  page: Resting,
  saver: Saver,
  now: number,
): { act: 'freeze' | 'park' | null; again: number | null } {
  const away = now - page.looked
  const saving = saver === 'off' ? null : SAVING[saver]
  if (saving && away >= saving.after && mayPark(page, now)) return { act: 'park', again: null }

  const freezing = away >= FROZEN_AFTER && mayFreeze(page, now)
  const waits = [
    page.frozen || freezing ? null : FROZEN_AFTER - away,
    saving ? saving.after - away : null,
  ].filter((wait) => wait !== null)

  const soonest = waits.length ? Math.min(...waits) : null
  return {
    act: freezing ? 'freeze' : null,
    again: soonest === null ? null : soonest > 0 ? soonest : FROZEN_AFTER,
  }
}

export function overCap(pages: readonly Resting[], saver: Saver, now: number): string[] {
  if (saver === 'off') return []

  const live = pages.filter((page) => page.live)
  const over = live.length - SAVING[saver].live
  if (over <= 0) return []

  return live
    .filter((page) => mayPark(page, now))
    .sort((one, other) => one.looked - other.looked)
    .slice(0, over)
    .map((page) => page.id)
}
