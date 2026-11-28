import { answer, frameWord, method, wordSaid } from '../../../platform/src/api'
import { tintOf } from '../look'
import type { Activity, Span } from '../records'
import { time } from '../time.svelte'

const MOST = 8
const HEX = /^#[0-9a-f]{6}$/i
const NO_COLOUR = '#808080'
export interface TrackSeen {
  running: { id: string; name: string; color: string; since: number } | null
  activities: { id: string; name: string; color: string }[]
  last: string
}
export type TrackAsk = { do: 'stop'; at: number } | { do: 'start'; id: string; at: number }
export function trackSeen(
  running: Pick<Span, 'activity' | 'start'> | null,
  latest: readonly Pick<Activity, 'id' | 'name' | 'archived'>[],
  colourOf: (id: string) => string,
): TrackSeen {
  const colour = (id: string) => {
    const said = colourOf(id)
    return HEX.test(said) ? said.toLowerCase() : NO_COLOUR
  }
  const live = latest.filter((one) => !one.archived)
  const going = running?.activity ? (latest.find((one) => one.id === running.activity) ?? null) : null
  return {
    running:
      going && running ? { id: going.id, name: going.name, color: colour(going.id), since: running.start } : null,
    activities: live.slice(0, MOST).map((one) => ({ id: one.id, name: one.name, color: colour(one.id) })),
    last: live[0]?.id ?? '',
  }
}
export function trackAsks(json: string): TrackAsk[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const asks: TrackAsk[] = []
  for (const one of parsed as unknown[]) {
    if (typeof one !== 'object' || one === null) continue
    const held = one as Record<string, unknown>
    const at = typeof held.at === 'number' && Number.isFinite(held.at) && held.at > 0 ? held.at : null
    if (at === null) continue
    if (held.do === 'stop') asks.push({ do: 'stop', at })
    else if (held.do === 'start' && typeof held.id === 'string' && held.id) asks.push({ do: 'start', id: held.id, at })
  }
  return asks.sort((one, other) => one.at - other.at)
}
export function runAsks(
  asks: readonly TrackAsk[],
  timer: { start(id: string, at: number): unknown; stop(at: number): void },
  now = Date.now(),
): number {
  let run = 0
  for (const ask of asks) {
    const at = Math.min(ask.at, now)
    if (ask.do === 'stop') timer.stop(at)
    else timer.start(ask.id, at)
    run += 1
  }
  return run
}
export function watchTrack(): () => void {
  const push = method('trackState')
  const take = method('trackTaken')
  if (!push || !take) return () => undefined
  let last = ''
  let gone = false
  const taken = () => {
    if (!time.ready) return
    void frameWord().then((word) => {
      if (word && !gone) runAsks(trackAsks(take(word)), time)
    })
  }
  const shown = () => {
    if (document.visibilityState === 'visible') taken()
  }
  answer('__ordenTrack', taken)
  document.addEventListener('visibilitychange', shown)
  const stop = $effect.root(() => {
    $effect(() => {
      if (time.ready) taken()
    })
    $effect(() => {
      if (!time.ready) return
      const said = JSON.stringify(trackSeen(time.running[0] ?? null, time.latest(), tintOf))
      if (said === last) return
      last = said
      void frameWord().then((word) => {
        if (gone) return
        if (word) push(word, said)
        else {
          last = ''
          void wordSaid().then((known) => {
            if (!gone && !last) push(known, (last = said))
          })
        }
      })
    })
  })
  return () => {
    gone = true
    answer('__ordenTrack', undefined)
    document.removeEventListener('visibilitychange', shown)
    stop()
  }
}
