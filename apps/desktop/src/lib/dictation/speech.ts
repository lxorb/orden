/** Where in a stream of samples somebody is speaking, and where they paused.
 *
 *  What decides what is sent at all. Whisper hears words in silence - four seconds of a
 *  quiet room came back as "Thank you for watching.", "Untertitel der Amara.org-Community"
 *  and "Obrigado." when #1128 was measured - so nothing without speech in it leaves, and
 *  what does leave is trimmed to the speech. And it decides where a stretch of live words
 *  ends: at a pause, where a model hearing the stretch on its own loses nothing.
 *
 *  By loudness against the room. Each 30 ms frame's level is measured, the room is the
 *  quietest frame of the last three seconds - there is always a gap between words, so a
 *  voice never becomes the room - and no louder than a room ever is once the browser's
 *  noise suppression has been at it, so a voice from the very first frame is still a
 *  voice. A frame well over the room is speech. Pure: samples in, frame numbers out. */

/** Samples a frame: 30 ms at 16 kHz. */
export const FRAME = 480

/** How much louder than the room a frame has to be to be speech. */
const OVER_ROOM = 3

/** And how loud at the least, for a room so quiet that three times it is still nothing:
 *  the browser's own noise suppression leaves a floor near zero. */
const LEAST = 0.005

/** How long the room is remembered for: three seconds, in frames. */
const ROOM_FRAMES = 100

/** The loudest a room is taken to be. */
const LOUDEST_ROOM = 0.01

/** How many frames of speech make an utterance rather than a click: about a quarter of a
 *  second. */
const SPOKEN_FRAMES = 8

/** What is kept either side of the speech when a stretch is trimmed: a model given a word
 *  cut off at its first consonant hears another word. */
const BEFORE = 10
const AFTER = 15

/** A pause long enough to end a stretch at: 0.8 s. */
const PAUSE_FRAMES = 27

/** How long a stretch of live words is before a pause may end it, and how long before it
 *  ends whether there was a pause or not: in frames, 4 s and 25 s. */
const SHORTEST = 133
const LONGEST = 833

/** The level of one frame: its root mean square. */
function levelOf(samples: Float32Array, from: number): number {
  const to = Math.min(samples.length, from + FRAME)
  let sum = 0
  for (let at = from; at < to; at++) {
    const one = samples[at] ?? 0
    sum += one * one
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0
}

/** The speech in a stream, frame by frame, as the stream grows. */
export class Ear {
  /** Each whole frame's level. */
  readonly levels: number[] = []
  /** Whether each frame was speech, against the room as it was then. */
  readonly speech: boolean[] = []
  private heard = 0

  /** The frames the samples so far complete. `samples` is the whole stream, of which
   *  everything up to the last whole frame has been heard already. */
  hear(samples: Float32Array): void {
    while (this.heard + FRAME <= samples.length) {
      const level = levelOf(samples, this.heard)
      this.levels.push(level)
      this.speech.push(level > Math.max(this.room() * OVER_ROOM, LEAST))
      this.heard += FRAME
    }
  }

  /** How loud the room is: the quietest of the frames remembered, at most a room's. */
  private room(): number {
    let quietest = LOUDEST_ROOM
    for (let at = Math.max(0, this.levels.length - ROOM_FRAMES); at < this.levels.length; at++) {
      quietest = Math.min(quietest, this.levels[at] ?? LOUDEST_ROOM)
    }
    return quietest
  }

  /** How many frames of speech lie between two frames. */
  spokenIn(from: number, to: number): number {
    let count = 0
    for (let at = Math.max(0, from); at < Math.min(to, this.speech.length); at++) {
      if (this.speech[at]) count++
    }
    return count
  }

  /** Whether there is an utterance between two frames, rather than only the room. */
  saysAnything(from: number, to: number): boolean {
    return this.spokenIn(from, to) >= SPOKEN_FRAMES
  }

  /** The frames between two that hold the speech, with a little either side; null where
   *  nothing in them is speech. */
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

  /** Where a stretch of live words that began at `from` ends, now that `to` frames are
   *  in: in the middle of the last long pause once it is long enough, at its quietest
   *  frame once it is too long, and null while it goes on. */
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

  /** The frames a long stretch is cut into, each at most `most` long and each cut at the
   *  quietest frame of its last third: a whole utterance heard in as few requests as the
   *  route allows, and never cut in the middle of a word it could have waited for. */
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

/** A level as the meter shows it, from nothing to one: decibels from -55 to -15, which is
 *  a quiet room to somebody speaking up close. */
export function meter(level: number): number {
  if (level <= 0) return 0
  const decibels = 20 * Math.log10(level)
  return Math.min(1, Math.max(0, (decibels + 55) / 40))
}
