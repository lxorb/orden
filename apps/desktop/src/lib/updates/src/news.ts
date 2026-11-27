import type { Mood } from '../../mascot/src/api'
import { keep, storedText } from '../../platform/src/api'

const SEEN_KEY = 'orden:version-seen'
const BEFORE_KEY = 'orden:version-before'
const RELEASE = /^\d+\.\d+\.\d+$/
export interface Shipped {
  version: string
  bugs: number
  added: string[]
}
export interface News {
  version: string
  since: string
  bugs: number
  added: string[]
  updates: number
  byHand?: boolean
}
const FACES: readonly Mood[] = [
  'excited',
  'proud',
  'cool',
  'flexing',
  'love',
  'waving',
  'hug',
  'relieved',
  'happy',
  'innocent',
]
export function faceAfter(last: string | null, random: () => number = Math.random): Mood {
  const choices = FACES.filter((one) => one !== last)
  return choices[Math.floor(random() * choices.length)] ?? 'happy'
}
const parts = (version: string) => version.split('.').map(Number)
function newer(one: string, than: string): boolean {
  const [a, b] = [parts(one), parts(than)]
  for (let at = 0; at < 3; at++) if (a[at] !== b[at]) return (a[at] ?? 0) > (b[at] ?? 0)
  return false
}
export function newsOf(shipped: readonly Shipped[], seen: string, now: string): News | null {
  const since = /^\d+\.\d+\.\d+/.exec(seen)?.[0]
  if (!since) return null
  const away = shipped
    .filter((one) => RELEASE.test(one.version) && !newer(one.version, now))
    .filter((one) => newer(one.version, since) || (one.version === since && seen !== since))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : 1))
  const bugs = away.reduce((sum, one) => sum + one.bugs, 0)
  const added = away.flatMap((one) => one.added)
  if (bugs === 0 && added.length === 0) return null
  return { version: now, since, bugs, added, updates: away.length }
}
export function newsSince(now: string = __APP_VERSION__, shipped: readonly Shipped[] = __RELEASE_NEWS__): News | null {
  const seen = storedText(SEEN_KEY)
  if (seen === now) return null
  keep(SEEN_KEY, now)
  if (seen === null || !RELEASE.test(now)) return null
  keep(BEFORE_KEY, seen)
  return newsOf(shipped, seen, now)
}
export function newsByHand(now: string = __APP_VERSION__, shipped: readonly Shipped[] = __RELEASE_NEWS__): News | null {
  const running = /^\d+\.\d+\.\d+/.exec(now)?.[0]
  const known = shipped
    .filter((one) => RELEASE.test(one.version) && (!running || !newer(one.version, running)))
    .sort((a, b) => (newer(a.version, b.version) ? 1 : -1))
  const latest = known.at(-1)
  if (!latest) return null
  const before = storedText(BEFORE_KEY)
  const found =
    (before === null ? null : newsOf(known, before, latest.version)) ??
    newsOf(known, known.at(-2)?.version ?? '0.0.0', latest.version)
  return found && { ...found, byHand: true }
}
