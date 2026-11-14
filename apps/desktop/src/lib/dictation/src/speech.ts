export const FRAME = 480

const OVER_ROOM = 3

const LEAST = 0.005

const ROOM_FRAMES = 100

const LOUDEST_ROOM = 0.01

const SPOKEN_FRAMES = 8

const BEFORE = 10
const AFTER = 15

const PAUSE_FRAMES = 27

const SHORTEST = 133
const LONGEST = 833

function levelOf(samples: Float32Array, from: number): number {
  const to = Math.min(samples.length, from + FRAME)
  let sum = 0
  for (let at = from; at < to; at++) {
    const one = samples[at] ?? 0
    sum += one * one
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0
}

export class Ear {
  readonly levels: number[] = []
  readonly speech: boolean[] = []
  private heard = 0

  hear(samples: Float32Array): void {
    while (this.heard + FRAME <= samples.length) {
      const level = levelOf(samples, this.heard)
      this.levels.push(level)
      this.speech.push(level > Math.max(this.room() * OVER_ROOM, LEAST))
      this.heard += FRAME
    }
  }

  private room(): number {
    let quietest = LOUDEST_ROOM
    for (let at = Math.max(0, this.levels.length - ROOM_FRAMES); at < this.levels.length; at++) {
      quietest = Math.min(quietest, this.levels[at] ?? LOUDEST_ROOM)
    }
    return quietest
  }

  spokenIn(from: number, to: number): number {
    let count = 0
    for (let at = Math.max(0, from); at < Math.min(to, this.speech.length); at++) {
      if (this.speech[at]) count++
    }
    return count
  }

  saysAnything(from: number, to: number): boolean {
    return this.spokenIn(from, to) >= SPOKEN_FRAMES
  }

  trimmed(from: number, to: number): { from: number; to: number } | null {
    let first = -1
    let last = -1
    for (let at = Math.max(0, from); at < Math.min(to, this.speech.length); at++) {
      if (!this.speech[at]) continue
      if (first < 0) first = at
      last = at
    }
    if (first < 0) return null
    return { from: Math.max(from, first - BEFORE), to: Math.min(to, last + 1 + AFTER) }
  }

  endOf(from: number, to: number): number | null {
    const length = to - from
    if (length < SHORTEST) return null

    let pause = 0
    let found: number | null = null
    for (let at = from + SHORTEST; at < to; at++) {
      pause = this.speech[at] ? 0 : pause + 1
      if (pause >= PAUSE_FRAMES && this.spokenIn(from, at - pause + 1) >= SPOKEN_FRAMES) {
        found = at - Math.floor(pause / 2)
      }
    }
    if (found !== null) return found
    return length >= LONGEST ? this.quietest(from + SHORTEST, to) : null
  }

  piecesOf(from: number, to: number, most: number): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = []
    let start = from
    while (to - start > most) {
      const cut = this.quietest(start + Math.floor((most * 2) / 3), start + most)
      out.push({ from: start, to: cut })
      start = cut
    }
    out.push({ from: start, to })
    return out
  }

  private quietest(from: number, to: number): number {
    let best = from
    for (let at = from; at < Math.min(to, this.levels.length); at++) {
      if ((this.levels[at] ?? 0) < (this.levels[best] ?? Infinity)) best = at
    }
    return best
  }
}

export function meter(level: number): number {
  if (level <= 0) return 0
  const decibels = 20 * Math.log10(level)
  return Math.min(1, Math.max(0, (decibels + 55) / 40))
}
