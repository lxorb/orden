import { key, message } from '../i18n.svelte'
import { heardPiece } from '../recorder/transcribe'
import { RATE, wavOf } from '../recorder/wav'
import { type Capture, capture } from './capture'
import type { Taken } from './engines.svelte'
import { cleaned, promptOf } from './heard'
import { local } from './local.svelte'
import { Ear, FRAME, meter } from './speech'
import { type Field, Spot } from './spot'

export type Road = Exclude<Taken, 'device'>

const LIVE_EVERY: Record<Road, number> = { local: 300, provider: 1_200, account: 2_500 }

const NEW_SPEECH = 8

const PIECE = 2_000

const FINAL_TRIES = 3
const LIVE_TRIES = 1

export interface Hooks {
  level: (level: number) => void
  full: () => void
  ended: () => void
  trouble: (said: string) => void
}

export interface Listening {
  finish: () => Promise<void>
  cancel: () => void
}

type Hears = (samples: Float32Array, prompt: string, tries: number) => Promise<string>

export async function listen(
  field: Field,
  engine: Road,
  words: readonly string[],
  hooks: Hooks,
): Promise<Listening> {
  const hears: Hears =
    engine === 'local'
      ? await hearsHere(words)
      : async (samples, prompt, tries) =>
          (await heardPiece(wavOf(samples, RATE), { prompt, road: engine, tries })).text

  const session = new Session(field, words, hears, LIVE_EVERY[engine], hooks)
  await session.open()
  return { finish: () => session.finish(), cancel: () => session.cancel() }
}

export async function hearsHere(words: readonly string[]): Promise<Hears> {
  if (!local.ready) {
    void local.fetch()
    throw new Error(key('The speech model is still downloading.'))
  }
  await local.open()
  const { invoke } = await import('../native')
  const names = new TextEncoder().encode(words.join('\n'))
  return (samples, _prompt, tries) => {
    const said = tries === FINAL_TRIES ? names : new Uint8Array()
    const body = new Uint8Array(4 + said.length + samples.byteLength)
    new DataView(body.buffer).setUint32(0, said.length, true)
    body.set(said, 4)
    body.set(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
      4 + said.length,
    )
    return invoke<string>('dictation_local_hear', body)
  }
}

export class Session {
  private readonly ear = new Ear()
  private readonly spot: Spot
  private microphone: Capture | null = null
  private readonly settled: string[] = []
  private live = ''
  private from = 0
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

  heard(samples: Float32Array): void {
    if (this.over) return
    this.ear.hear(samples)
    const recent = this.ear.levels.slice(-4)
    const level = meter(recent.length ? Math.max(...recent) : 0)
    this.shown = level > this.shown ? level : this.shown * 0.6 + level * 0.4
    this.hooks.level(this.shown)
    this.tick(samples)
  }

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
      this.liveOn = false
    } finally {
      this.passing = false
    }
    if (this.microphone) this.tick(this.microphone.samples())
  }

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
