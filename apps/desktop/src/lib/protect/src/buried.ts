import {
  insideItsSpace,
  insideSpace,
  invoke,
  isRecord,
  keepJson,
  stored,
  within,
  without,
} from '../../platform/src/api'
import type { Way } from './protection.svelte'

const BURIED_KEY = 'orden:protected-buried'
const MOST_BURIED = 1000
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
  held: Record<string, Way>,
): Promise<void> {
  const ways: Record<string, Way> = {}
  for (const [key, way] of Object.entries(held)) {
    const rest = at ? (key ? within(at, key, root) : null) : key
    if (rest !== null) ways[rest] = way
  }
  if (!Object.keys(ways).length) return
  const away = `${HISTORY_AWAY}/${crypto.randomUUID()}`
  for (const name of [placeOf(root, at), back ?? null]) {
    if (name === null) continue
    keepBuried(name, ways)
    keepHistory(name, away)
  }
  await rehome(pathOf(root, at), away)
}

function landedAt(at: string, rest: string): string {
  return at && rest ? `${at}/${rest}` : at || rest
}

async function exactly(
  named: string,
  root: string,
  at: string,
  held: Record<string, Way>,
): Promise<Record<string, Way> | null> {
  const histories = readHistories()
  const away = histories[named]
  if (away !== undefined) {
    keepJson(HISTORY_KEY, without(histories, named))
    await rehome(away, pathOf(root, at))
  }
  const buried = readBuried()
  const ways = buried[named]
  keepJson(BURIED_KEY, without(buried, named))
  const came: Record<string, Way> = {}
  for (const [rest, way] of Object.entries(ways ?? {})) {
    const landed = landedAt(at, rest)
    if (inSpace(landed) && !(landed in held)) came[landed] = way
  }
  return came
}

async function under(
  root: string,
  was: string,
  at: string,
  held: Record<string, Way>,
): Promise<Record<string, Way>> {
  const came: Record<string, Way> = {}
  const histories = readHistories()
  const there = pathOf(root, was)
  for (const [name, ways] of Object.entries(readBuried())) {
    if (!name.startsWith(`${root}\n`)) continue
    const folder = name.slice(root.length + 1)
    if (folder === was || within(folder, was, root) === null) continue
    for (const [rest, way] of Object.entries(ways)) {
      const key = landedAt(folder, rest)
      const inside = within(was, key, root)
      const landed = inside === null ? key : landedAt(at, inside)
      const near = inside !== null || within(key, was, root) !== null
      if (near && inSpace(landed) && !(landed in held)) came[landed] = way
    }
    const away = histories[name]
    const from = `${away}${there.slice(pathOf(root, folder).length)}`
    if (away !== undefined) await rehome(from, pathOf(root, at))
  }
  return came
}

export async function unburied(
  back: string | null,
  root: string,
  at: string,
  held: Record<string, Way>,
  was = at,
): Promise<Record<string, Way> | null> {
  if (!inSpace(at) || !inSpace(was)) return null
  const buried = readBuried()
  const place = placeOf(root, was)
  const named = [back, place].find((one) => one !== null && one in buried) ?? null
  const came = {
    ...(await under(root, was, at, held)),
    ...(named === null ? {} : await exactly(named, root, at, held)),
  }
  if (named !== null && named !== place && place in buried) {
    keepJson(BURIED_KEY, without(readBuried(), place))
    keepJson(HISTORY_KEY, without(readHistories(), place))
  }
  return Object.keys(came).length ? came : null
}

export function moveSpace(from: string, to: string): void {
  const moved = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).map(([name, one]) => [
        name.startsWith(`${from}\n`) ? `${to}${name.slice(from.length)}` : name,
        one,
      ]),
    )
  keepJson(BURIED_KEY, moved(readBuried()))
  keepJson(HISTORY_KEY, moved(readHistories()))
}

export function waits(back: string | null, root: string | null, at: string): boolean {
  return Object.keys(readBuried()).some(
    (name) =>
      back === null ||
      name === back ||
      (root !== null &&
        name.startsWith(`${root}\n`) &&
        within(name.slice(root.length + 1), at, root) !== null),
  )
}
