import {
  insideItsSpace,
  insideSpace,
  invoke,
  isRecord,
  keepJson,
  stored,
  without,
} from '../../platform/src/api'
import type { Way } from './protection.svelte'

const BURIED_KEY = 'orden:protected-buried'
const MOST_BURIED = 200
const HISTORY_KEY = 'orden:protected-buried-history'
const HISTORY_AWAY = '/.orden-locked-history'

type Buried = Record<string, Record<string, Way>>

const isWay = (value: unknown): value is Way => value === 'password' || value === 'device'

const inSpace = (at: string) => at === '' || insideItsSpace(at)

function readBuried(): Buried {
  const saved = stored(BURIED_KEY)
  if (!isRecord(saved)) return {}
  const out: Buried = {}
  for (const [back, ways] of Object.entries(saved)) {
    if (!isRecord(ways)) continue
    const kept = Object.entries(ways).filter(([rest, way]) => inSpace(rest) && isWay(way))
    if (kept.length) out[back] = Object.fromEntries(kept) as Record<string, Way>
  }
  return out
}

function placeOf(root: string, at: string): string {
  return `${root}\n${at}`
}

function keepBuried(back: string, ways: Record<string, Way>): void {
  const buried = Object.entries({ ...without(readBuried(), back), [back]: ways })
  keepJson(BURIED_KEY, Object.fromEntries(buried.slice(-MOST_BURIED)))
}

function readHistories(): Record<string, string> {
  const saved = stored(HISTORY_KEY)
  if (!isRecord(saved)) return {}
  return Object.fromEntries(
    Object.entries(saved).filter((one): one is [string, string] => typeof one[1] === 'string'),
  )
}

function keepHistory(name: string, away: string): void {
  const kept = Object.entries({ ...without(readHistories(), name), [name]: away })
  keepJson(HISTORY_KEY, Object.fromEntries(kept.slice(-MOST_BURIED)))
}

const pathOf = (root: string, at: string) => (at ? insideSpace(root, at) : root)

const rehome = (from: string, to: string) =>
  invoke<number>('rehome_snapshots', { from, to }).catch(() => 0)

export async function bury(
  root: string,
  at: string,
  back: string | undefined,
  ways: Record<string, Way>,
): Promise<void> {
  if (!Object.keys(ways).length) return
  const away = `${HISTORY_AWAY}/${crypto.randomUUID()}`
  for (const name of [at ? placeOf(root, at) : null, back ?? null]) {
    if (name === null) continue
    keepBuried(name, ways)
    keepHistory(name, away)
  }
  await rehome(pathOf(root, at), away)
}

export async function unburied(
  back: string | null,
  root: string,
  at: string,
  held: Record<string, Way>,
): Promise<Record<string, Way> | null> {
  const named = back ?? placeOf(root, at)
  const histories = readHistories()
  const away = histories[named]
  if (away !== undefined) {
    keepJson(HISTORY_KEY, without(histories, named))
    if (inSpace(at)) await rehome(away, pathOf(root, at))
  }
  const buried = readBuried()
  const ways = buried[named]
  if (!ways) return null
  keepJson(BURIED_KEY, without(buried, named))
  if (!inSpace(at)) return null
  const came: Record<string, Way> = {}
  for (const [rest, way] of Object.entries(ways)) {
    const landed = at && rest ? `${at}/${rest}` : at || rest
    if (inSpace(landed) && !(landed in held)) came[landed] = way
  }
  return Object.keys(came).length ? came : null
}
