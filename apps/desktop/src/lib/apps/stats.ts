/** What the developer overlay of an application's tab says of its picture (issue 1063,
 *  step 9; docs/apps.md): the stream as the engine counts it, and glass to glass - from
 *  the moment the host read a frame's picture off the application's display to the
 *  moment this screen shows it.
 *
 *  **The two clocks side by side.** The tab pings the host over the data channel; the
 *  host answers with the tab's time back and its own (`Pong`). Half the round trip is
 *  taken as the way there, as NTP takes it, so the host's clock is the tab's plus the
 *  offset. A frame's RTP time counts from when the connection began on the host's clock,
 *  at 90 kHz, from when its picture was read; the engine says, for each frame it shows,
 *  its RTP time and when it is shown (`requestVideoFrameCallback`). */

import type { Pong } from '@orden/online/apps'

/** The host's clock against this one's: the host's time is this one's plus `offset`,
 *  known to within half of `rtt`. */
export interface Clock {
  offset: number
  rtt: number
}

/** The clock a pong sets, heard at `heard` on this one's. */
export function clockOf(pong: Pong, heard: number): Clock {
  const rtt = Math.max(0, heard - pong.at)
  return { offset: pong.now - (pong.at + rtt / 2), rtt }
}

/** RTP's 32 bits at 90 kHz come round every 13 hours and a quarter, in milliseconds. */
const WRAP = 2 ** 32 / 90

/** When a frame's picture was read off the display, on this clock: its RTP time from
 *  when the connection began, the turn of the 32 bits nearest the host's time now. */
export function seenAt(rtp: number, began: number, clock: Clock, now: number): number {
  const since = rtp / 90
  const hostNow = now + clock.offset
  const turns = Math.round((hostNow - began - since) / WRAP)
  return began + since + turns * WRAP - clock.offset
}

/** The middle of a set of numbers, or null for none. */
export function middle(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((one, other) => one - other)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

/** The stream, once a second, as the overlay shows it. */
export interface StreamStats {
  width: number | null
  height: number | null
  fps: number | null
  /** Bits a second, over the last second. */
  bitrate: number | null
  /** How unevenly frames came over the last second: the spread of the gaps between
   *  them, in milliseconds. */
  pacing: number | null
  /** The connection's round trip, in milliseconds. */
  rtt: number | null
  dropped: number
  lost: number
  codec: string | null
  /** How the connection goes: `host` straight across, `srflx` or `prflx` through a
   *  router's address, `relay` through TURN. */
  route: string | null
}

/** The running counts the next second's numbers are worked out from. */
export interface Counts {
  at: number
  bytes: number
  frames: number
  delay: number
  squared: number
}

type Stat = Record<string, unknown> & { type?: unknown; id?: unknown }

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** The overlay's numbers from the engine's `getStats()`, with the counts of a second
 *  ago for the rates; and the counts now. */
export function streamStats(
  report: Iterable<Stat>,
  before: Counts | null,
  at: number,
): { stats: StreamStats; counts: Counts | null } {
  const all = [...report]
  const byId = new Map(all.map((one) => [one.id, one]))
  const video = all.find((one) => one.type === 'inbound-rtp' && one.kind === 'video')
  const pair = all.find(
    (one) => one.type === 'candidate-pair' && (one.nominated === true || one.selected === true),
  )
  const remote = pair ? byId.get(pair.remoteCandidateId) : undefined
  const local = pair ? byId.get(pair.localCandidateId) : undefined
  const codec = video ? byId.get(video.codecId) : undefined
  const rtt = num(pair?.currentRoundTripTime)
  const types = [local?.candidateType, remote?.candidateType]
  const route = types.includes('relay')
    ? 'relay'
    : (types.find((one): one is string => typeof one === 'string' && one !== 'host') ??
      (typeof local?.candidateType === 'string' ? local.candidateType : null))
  const counts: Counts | null = video
    ? {
        at,
        bytes: num(video.bytesReceived) ?? 0,
        frames: num(video.framesDecoded) ?? 0,
        delay: num(video.totalInterFrameDelay) ?? 0,
        squared: num(video.totalSquaredInterFrameDelay) ?? 0,
      }
    : null
  let bitrate: number | null = null
  let pacing: number | null = null
  if (counts && before && counts.at > before.at) {
    bitrate = ((counts.bytes - before.bytes) * 8 * 1000) / (counts.at - before.at)
    const frames = counts.frames - before.frames
    if (frames > 1) {
      const sum = counts.delay - before.delay
      const squares = counts.squared - before.squared
      const variance = Math.max(0, squares / frames - (sum / frames) ** 2)
      pacing = Math.sqrt(variance) * 1000
    }
  }
  return {
    stats: {
      width: num(video?.frameWidth),
      height: num(video?.frameHeight),
      fps: num(video?.framesPerSecond),
      bitrate,
      pacing,
      rtt: rtt === null ? null : rtt * 1000,
      dropped: num(video?.framesDropped) ?? 0,
      lost: num(video?.packetsLost) ?? 0,
      codec: typeof codec?.mimeType === 'string' ? codec.mimeType.replace(/^video\//, '') : null,
      route,
    },
    counts,
  }
}
