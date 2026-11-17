import type { Pong } from '@orden/online/apps'

export interface Clock {
  offset: number
  rtt: number
}

export function clockOf(pong: Pong, heard: number): Clock {
  const rtt = Math.max(0, heard - pong.at)
  return { offset: pong.now - (pong.at + rtt / 2), rtt }
}

const WRAP = 2 ** 32 / 90

export function seenAt(rtp: number, began: number, clock: Clock, now: number): number {
  const since = rtp / 90
  const hostNow = now + clock.offset
  const turns = Math.round((hostNow - began - since) / WRAP)
  return began + since + turns * WRAP - clock.offset
}

export function middle(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((one, other) => one - other)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

export interface StreamStats {
  width: number | null
  height: number | null
  fps: number | null
  bitrate: number | null
  pacing: number | null
  rtt: number | null
  dropped: number
  lost: number
  codec: string | null
  route: string | null
}

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
