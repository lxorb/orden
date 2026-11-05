/** One dictation, from the microphone opening to the final words in the field (#1128).
 *
 *  Two kinds of pass over the same samples, both through the road the reader chose
 *  (recorder/transcribe.ts):
 *
 *  - **Live words**, while the voice goes on: the stretch since the last pause is heard
 *    again, a moment after each new bit of speech, and drawn in the field as words still
 *    being heard. A stretch ends at a pause (speech.ts) and is heard once more as a
 *    whole, which is what it then says until the end. One request at a time, never
 *    more often than the road can bear: the account's route is shared with every other
 *    voice on the account, so it is asked half as often as the reader's own provider.
 *  - **The final words**, once: the whole utterance, cut only where it must be, heard
 *    with what comes before the caret. They replace the live words in one edit.
 *
 *  The live words cannot be the final ones. Measured for #1128, the same sentences cut
 *  into short pieces came back five to twenty-five times worse than heard whole: a
 *  model hearing half a sentence guesses the other half. So the live words show that
 *  the voice is arriving, and the final pass is what stays.
 *
 *  A live pass that fails stops the live passes and nothing else; a final pass that
 *  fails leaves the live words as plain text and says why. */

import { key, message } from '../i18n.svelte'
import { heardPiece } from '../recorder/transcribe'
import { RATE, wavOf } from '../recorder/wav'
import { type Capture, capture } from './capture'
import type { Engine } from './engines.svelte'
import { cleaned, promptOf } from './heard'
import { Ear, FRAME, meter } from './speech'
import { type Field, Spot } from './spot'

/** How long after one live pass the next may start, by road. */
const LIVE_EVERY: Record<Engine, number> = { provider: 1_200, account: 2_500 }

/** How much new speech a live pass waits for: a quarter of a second, in frames. */
const NEW_SPEECH = 8

/** The longest piece of a final pass: sixty seconds, in frames, which is what one
 *  request carries comfortably (recorder/transcribe.ts). */
const PIECE = 2_000

/** How many times a final piece is tried, and a live one. */
const FINAL_TRIES = 3
const LIVE_TRIES = 1

/** What a dictation tells the field it writes for. */
export interface Hooks {
  /** The voice's level, nought to one, a few times a second. */
  level: (level: number) => void
  /** Five minutes heard: the caller finishes. */
  full: () => void
  /** The reader typed into the words, which ends the dictation with them as they are. */
  ended: () => void
  trouble: (said: string) => void
}

/** A dictation under way. */
export interface Listening {
  finish: () => Promise<void>
  cancel: () => void
}

/** A road from samples to words, as the passes ask for them. */
type Hears = (samples: Float32Array, prompt: string, tries: number) => Promise<string>

/** Opens the microphone over a field and starts listening into it. */
export async function listen(
  field: Field,
  engine: Engine,
  words: readonly string[],
  hooks: Hooks,
): Promise<Listening> {
  const hears: Hears = async (samples, prompt, tries) =>
    (await heardPiece(wavOf(samples, RATE), { prompt, road: engine, tries })).text

  const session = new Session(field, words, hears, LIVE_EVERY[engine], hooks)
  await session.open()
  return { finish: () => session.finish(), cancel: () => session.cancel() }
}

/** Everything one dictation holds. Exported for its tests, which hand it a road and
 *  samples of their own. */
export class Session {
  private readonly ear = new Ear()
  private readonly spot: Spot
  private microphone: Capture | null = null
  /** What the stretches that have ended say, in order. */
  private readonly settled: string[] = []
  /** What the stretch under way says so far. */
  private live = ''
  /** The frame the stretch under way began at. */
  private from = 0
  /** The last frame the last live pass heard, and when it started. */
  private heardTo = 0
  private heardAt = -Infinity
  private passing = false
  private liveOn = true
  private over = false
  private shown = 0

  constructor(
    field: Field,
    private readonly words: readonly string[],
    private readonly hears: Hears,
    private readonly every: number,
    private readonly hooks: Hooks,
    private readonly opens: typeof capture = capture,
  ) {
    this.spot = new Spot(field, () => this.brokenOff())
  }

  async open(): Promise<void> {
    try {
      this.microphone = await this.opens(
        (samples) => this.heard(samples),
        () => this.hooks.full(),
      )
    } catch (error) {
      this.spot.release()
      throw error
    }
  }

  /** The samples so far, as a block arrives. */
  heard(samples: Float32Array): void {
    if (this.over) return
    this.ear.hear(samples)
    const recent = this.ear.levels.slice(-4)
    const level = meter(recent.length ? Math.max(...recent) : 0)
    // Up at once, down slowly, as a meter on a mixing desk falls.
    this.shown = level > this.shown ? level : this.shown * 0.6 + level * 0.4
    this.hooks.level(this.shown)
    this.tick(samples)
  }

  /** Starts the next live pass, where one is due. */
  private tick(samples: Float32Array): void {
    if (this.over || this.passing || !this.liveOn) return
    const now = this.ear.levels.length
    const end = this.ear.endOf(this.from, now)
    if (end !== null) {
      void this.pass(samples, this.from, end, true)
      return
    }
    if (performance.now() - this.heardAt < this.every) return
    if (this.ear.spokenIn(this.heardTo, now) < NEW_SPEECH) return
    void this.pass(samples, this.from, now, false)
  }

  private async pass(samples: Float32Array, from: number, to: number, ends: boolean) {
    this.passing = true
    this.heardAt = performance.now()
    this.heardTo = to
    try {
      const said = await this.hear(samples, from, to, LIVE_TRIES, this.saidSoFar())
      if (this.over) return
      if (ends) {
        if (said) this.settled.push(said)
        this.from = to
        this.live = ''
      } else {
        this.live = said
      }
      this.spot.show(this.saidNow(), true)
    } catch {
      // The final pass is still to come, and it is what stays.
      this.liveOn = false
    } finally {
      this.passing = false
    }
    if (this.microphone) this.tick(this.microphone.samples())
  }

  /** The words between two frames, or nothing where nobody spoke in them. */
  private async hear(
    samples: Float32Array,
    from: number,
    to: number,
    tries: number,
    before: string,
  ): Promise<string> {
    const span = this.ear.trimmed(from, to)
    if (!span || !this.ear.saysAnything(span.from, span.to)) return ''
    const prompt = promptOf(before, this.words)
    const piece = samples.slice(span.from * FRAME, span.to * FRAME)
    const said = await this.hears(piece, prompt, tries)
    return cleaned(said, prompt, (this.ear.spokenIn(span.from, span.to) * FRAME) / RATE)
  }

  private saidSoFar(): string {
    return [this.spot.before(), ...this.settled].join(' ')
  }

  private saidNow(): string {
    return [...this.settled, this.live].filter(Boolean).join(' ')
  }

  /** The final words, once, in place of the live ones. */
  async finish(): Promise<void> {
    if (this.over) return
    this.over = true
    const samples = this.microphone?.samples() ?? new Float32Array()
    this.microphone?.stop()
    this.hooks.level(0)

    try {
      const span = this.ear.trimmed(0, this.ear.levels.length)
      const said: string[] = []
      for (const piece of span ? this.ear.piecesOf(span.from, span.to, PIECE) : []) {
        const before = [this.spot.before(), ...said].join(' ')
        const words = await this.hear(samples, piece.from, piece.to, FINAL_TRIES, before)
        if (words) said.push(words)
      }
      this.spot.show(said.join(' '), false)
    } catch (error) {
      this.spot.show(this.saidNow(), false)
      this.hooks.trouble(message(error, key('That recording could not be turned into words.')))
    } finally {
      this.spot.release()
    }
  }

  /** Stops, and puts the field back. */
  cancel(): void {
    if (this.over) return
    this.over = true
    this.microphone?.stop()
    this.spot.restore()
    this.spot.release()
  }

  private brokenOff(): void {
    if (this.over) return
    this.over = true
    this.microphone?.stop()
    this.spot.release()
    this.hooks.ended()
  }
}
