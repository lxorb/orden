import type { Notify } from '@orden/chats'
import { isMuted, levelOf, MUTED_FOR_GOOD } from '@orden/chats/notify'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'

const HOUR = 60 * 60 * 1000
const MUTE_HOURS = [1, 8, 24, 7 * 24] as const
export type Ring = 'all' | 'mentions' | 'off'
export function ringOf(notify: Notify | null, mutedUntil: number | null, members: number, now: number): Ring {
  if (isMuted(mutedUntil, now)) return 'off'
  const level = levelOf(notify, members)
  return level === 'nothing' ? 'off' : level
}
export function mutedUntil(hours: number | null, now: number): number {
  return hours === null ? MUTED_FOR_GOOD : now + hours * HOUR
}
function length(hours: number): string {
  return hours < 24 ? `${hours} h` : hours / 24 === 1 ? '1 day' : `${hours / 24} days`
}
export function bellRows(
  notify: Notify | null,
  muted: number | null,
  members: number,
  now: number,
  change: (notify: Notify | null, mutedUntil: number | null) => void,
): MenuEntry[] {
  const level = ringOf(notify, null, members, now)
  const levels: [Notify, string][] = [
    ['all', 'All'],
    ['mentions', 'Mentions'],
    ['nothing', 'Nothing'],
  ]
  const rows: MenuEntry[] = levels.map(([value, label]) => ({
    label,
    checked: value === 'nothing' ? level === 'off' : level === value,
    run: () => change(value, muted),
  }))
  const mute: MenuEntry = isMuted(muted, now)
    ? { label: 'Unmute', run: () => change(notify, null) }
    : {
        label: 'Mute',
        run: () => change(notify, mutedUntil(null, Date.now())),
        more: () =>
          Promise.resolve(
            MUTE_HOURS.map((hours) => ({
              label: length(hours),
              run: () => change(notify, mutedUntil(hours, Date.now())),
            })),
          ),
      }
  return [...rows, DIVIDER, mute]
}
