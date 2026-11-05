import { describe, expect, test } from 'vitest'
import { clockOf, middle, seenAt, streamStats } from './stats'

/** The developer overlay's numbers (issue 1063, step 9; stats.ts): the two clocks set
 *  side by side, a frame's time on this one, and the engine's counts read. */

const pong = (at: number, now: number) => ({
  t: 'pong' as const,
  at,
  began: 0,
  now,
  encoder: null,
  hardware: false,
})

describe('the clocks', () => {
  test('are set side by side by half the round trip', () => {
    // Sent at 1000 here, answered at 5010 there, heard at 1020 here: 5000 ahead.
    expect(clockOf(pong(1000, 5010), 1020)).toEqual({ offset: 4000, rtt: 20 })
  })

  test('put a frame’s RTP time on this clock, the 32 bits come round or not', () => {
    const clock = { offset: 4000, rtt: 0 }
    // Began at 100 000 there; read 2 seconds in: 102 000 there, 98 000 here.
    expect(seenAt(180_000, 100_000, clock, 98_050)).toBeCloseTo(98_000)
    // Fourteen hours in, the RTP time has come round once.
    const wrap = 2 ** 32 / 90
    const fourteen = 14 * 3_600_000
    const rtp = ((fourteen * 90) % 2 ** 32) + 0
    expect(seenAt(rtp, 100_000, clock, 100_000 + fourteen - 4000)).toBeCloseTo(
      100_000 + fourteen - 4000,
    )
    expect(wrap).toBeGreaterThan(4.7e7)
  })

  test('the middle of what was measured', () => {
    expect(middle([30, 10, 20])).toBe(20)
    expect(middle([])).toBeNull()
  })
})

describe('the engine’s numbers', () => {
  const report = (bytes: number, frames: number, delay: number, squared: number) => [
    {
      id: 'v',
      type: 'inbound-rtp',
      kind: 'video',
      codecId: 'c',
      frameWidth: 1280,
      frameHeight: 800,
      framesPerSecond: 60,
      bytesReceived: bytes,
      framesDecoded: frames,
      totalInterFrameDelay: delay,
      totalSquaredInterFrameDelay: squared,
      framesDropped: 2,
      packetsLost: 1,
    },
    { id: 'c', type: 'codec', mimeType: 'video/VP8' },
    {
      id: 'p',
      type: 'candidate-pair',
      nominated: true,
      currentRoundTripTime: 0.004,
      localCandidateId: 'l',
      remoteCandidateId: 'r',
    },
    { id: 'l', type: 'local-candidate', candidateType: 'host' },
    { id: 'r', type: 'remote-candidate', candidateType: 'srflx' },
  ]

  test('are read, the rates over the second since the last', () => {
    const first = streamStats(report(0, 0, 0, 0), null, 1000)
    expect(first.stats).toMatchObject({
      width: 1280,
      height: 800,
      fps: 60,
      bitrate: null,
      codec: 'VP8',
      dropped: 2,
      lost: 1,
      route: 'srflx',
    })
    expect(first.stats.rtt).toBeCloseTo(4)
    // 60 frames 1/60 s apart, evenly: no spread.
    const gap = 1 / 60
    const second = streamStats(report(500_000, 60, 60 * gap, 60 * gap * gap), first.counts, 2000)
    expect(second.stats.bitrate).toBe(4_000_000)
    expect(second.stats.pacing).toBeCloseTo(0)
  })

  test('say nothing they do not have', () => {
    const none = streamStats([], null, 0)
    expect(none.stats).toMatchObject({ width: null, fps: null, rtt: null, route: null })
    expect(none.counts).toBeNull()
  })
})
