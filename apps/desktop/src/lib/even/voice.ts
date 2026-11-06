const RATE = 16_000
const BYTES_PER_SAMPLE = 2

export const QUIET = 420

const PEEK_AFTER = 400

const PEEKS = 2

const PEEK_AGAIN = 450

const LOUD = 0.02

const LONGEST = 8_000

const SHORTEST = 250

interface Heard {
  said: string
  ended: number
}

export interface Took {
  spoke: number
  hang: number
  sent: number
}

export interface Ears {
  microphone: (open: boolean) => Promise<boolean>
  settled?: (said: string) => boolean
  warm?: () => void
  canTranscribe: () => boolean
  transcribe: (wav: Uint8Array<ArrayBuffer>) => Promise<string | null>
  heard: (heard: Heard) => void
  failed: (why: string) => void
  said?: (state: Listening) => void
}

export interface Listening {
  on: boolean
  path: Path
  frames: number
  heard: string
  nothing: boolean
  trouble: string
  detail: string
  took: Took | null
}

const HOPELESS = new Set([
  'network',
  'service-not-allowed',
  'not-allowed',
  'audio-capture',
  'language-not-supported',
])

const NO_FRAMES = 2000

interface Recogniser {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechResults) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechResults {
  resultIndex: number
  results: {
    length: number
    [at: number]: { isFinal: boolean; 0?: { transcript?: string } }
  }
}

type RecogniserMaker = new () => Recogniser

function recogniserOf(): RecogniserMaker | null {
  const window_ = globalThis as {
    SpeechRecognition?: RecogniserMaker
    webkitSpeechRecognition?: RecogniserMaker
  }

  return window_.SpeechRecognition ?? window_.webkitSpeechRecognition ?? null
}

export function wavOf(pcm: Uint8Array, rate = RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const ascii = (at: number, text: string) => {
    for (let n = 0; n < text.length; n++) out[at + n] = text.charCodeAt(n)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true)
  ascii(36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)

  return out
}

export function loudnessOf(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE)
  if (!samples) return 0

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let sum = 0
  for (let at = 0; at < samples; at++) {
    const sample = view.getInt16(at * BYTES_PER_SAMPLE, true) / 0x8000
    sum += sample * sample
  }

  return Math.sqrt(sum / samples)
}

function millisOf(bytes: number, rate = RATE): number {
  return (bytes / BYTES_PER_SAMPLE / rate) * 1000
}

export class Utterance {
  private frames: Uint8Array[] = []
  private held = 0
  private quiet = 0
  private speaking = false
  private peeks = 0
  private looked = 0

  get spoken(): number {
    return millisOf(this.held) - this.quiet
  }

  peek(now: number): Uint8Array | null {
    if (!this.speaking || this.peeks >= PEEKS) return null
    if (this.spoken < PEEK_AFTER) return null
    if (this.peeks > 0 && now - this.looked < PEEK_AGAIN) return null

    this.peeks++
    this.looked = now
    return this.take()
  }

  forget(): void {
    this.reset()
  }

  hear(pcm: Uint8Array, now: number): { pcm: Uint8Array; ended: number; spoken: number } | null {
    const loud = loudnessOf(pcm) >= LOUD

    if (loud) {
      if (!this.speaking) {
        this.speaking = true
        this.frames = []
        this.held = 0
      }
      this.quiet = 0
    } else if (!this.speaking) {
      return null
    } else {
      this.quiet += millisOf(pcm.length)
    }

    this.frames.push(pcm)
    this.held += pcm.length

    const gathered = millisOf(this.held)
    const done = this.quiet >= QUIET || gathered >= LONGEST
    if (!done) return null

    const whole = this.take()
    if (millisOf(whole.length) - this.quiet < SHORTEST) {
      this.reset()
      return null
    }

    const ended = now - this.quiet
    const spoken = this.spoken
    this.reset()
    return { pcm: whole, ended, spoken }
  }

  private take(): Uint8Array {
    const whole = new Uint8Array(this.held)
    let at = 0
    for (const frame of this.frames) {
      whole.set(frame, at)
      at += frame.length
    }

    return whole
  }

  private reset(): void {
    this.frames = []
    this.held = 0
    this.quiet = 0
    this.speaking = false
    this.peeks = 0
    this.looked = 0
  }
}

export type Path = 'webview' | 'glasses' | 'none'

export class Voice {
  private on = false
  private recogniser: Recogniser | null = null
  private readonly utterance = new Utterance()
  private busy = false
  private looking = false
  private said = 0
  private spoke = 0
  private hung = 0
  private took: Took | null = null
  private hopeless = false
  private frames = 0
  private lastHeard = ''
  private nothing = false
  private trouble = ''
  private detail = ''
  private silence: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly ears: Ears) {}

  get listening(): boolean {
    return this.on
  }

  get path(): Path {
    if (this.recogniser) return 'webview'
    return this.hopeless || !recogniserOf() ? 'glasses' : 'webview'
  }

  get state(): Listening {
    return {
      on: this.on,
      path: this.path,
      frames: this.frames,
      heard: this.lastHeard,
      nothing: this.nothing,
      trouble: this.trouble,
      detail: this.detail,
      took: this.took,
    }
  }

  private tell(): void {
    this.ears.said?.(this.state)
  }

  private wrong(why: string, detail = ''): void {
    this.trouble = why
    this.detail = detail
    this.ears.failed(why)
    this.tell()
  }

  async start(): Promise<boolean> {
    if (this.on) return true

    this.trouble = ''
    this.detail = ''
    this.frames = 0
    this.nothing = false

    const maker = this.hopeless ? null : recogniserOf()
    if (maker && this.listenHere(maker)) {
      this.on = true
      this.tell()
      return true
    }

    return this.listenThere()
  }

  private async listenThere(): Promise<boolean> {
    this.ears.warm?.()

    const opened = await this.ears.microphone(true)
    this.on = opened
    if (!opened) {
      this.wrong('no microphone')
      return false
    }

    if (!this.ears.canTranscribe()) this.wrong('sign in first')

    clearTimeout(this.silence)
    this.silence = setTimeout(() => {
      if (this.on && this.frames === 0) this.wrong('no sound from the glasses')
    }, NO_FRAMES)

    this.tell()
    return true
  }

  async stop(): Promise<void> {
    clearTimeout(this.silence)
    if (!this.on) return

    this.on = false
    const recogniser = this.recogniser
    this.recogniser = null
    if (recogniser) {
      recogniser.onend = null
      recogniser.abort()
      this.tell()
      return
    }

    await this.ears.microphone(false)
    this.tell()
  }

  frame(pcm: Uint8Array): void {
    if (!this.on || this.recogniser) return

    const first = this.frames === 0
    this.frames++
    if (first) this.tell()

    const now = performance.now()
    const whole = this.utterance.hear(pcm, now)
    if (whole) {
      this.spoke = whole.spoken
      this.hung = QUIET
      void this.transcribe(whole.pcm, whole.ended)
      return
    }

    const early = this.utterance.peek(now)
    if (early) void this.early(early, now, this.utterance.spoken)
  }

  private async early(pcm: Uint8Array, now: number, spoken: number): Promise<void> {
    if (this.busy || this.looking || !this.ears.settled || !this.ears.canTranscribe()) return

    const mine = this.said
    this.looking = true
    try {
      const at = performance.now()
      const said = await this.ears.transcribe(wavOf(pcm))
      if (!said || mine !== this.said || !this.ears.settled(said)) return

      this.took = { spoke: Math.round(spoken), hang: 0, sent: Math.round(performance.now() - at) }
      this.said++
      this.utterance.forget()
      this.lastHeard = said
      this.nothing = false
      this.ears.heard({ said, ended: now })
      this.tell()
    } catch {
      // Nothing said out loud: the utterance itself is still coming.
    } finally {
      this.looking = false
    }
  }

  private async transcribe(pcm: Uint8Array, ended: number): Promise<void> {
    if (this.busy) return
    if (!this.ears.canTranscribe()) {
      this.wrong('sign in first')
      return
    }

    const mine = ++this.said
    this.busy = true
    try {
      const at = performance.now()
      const said = await this.ears.transcribe(wavOf(pcm))
      if (mine !== this.said) return

      this.took = {
        spoke: Math.round(this.spoke),
        hang: Math.round(this.hung),
        sent: Math.round(performance.now() - at),
      }
      this.nothing = !said
      if (said) {
        this.lastHeard = said
        this.ears.heard({ said, ended })
      }
      this.tell()
    } catch (error) {
      this.wrong('the words did not come back', error instanceof Error ? error.message : '')
    } finally {
      this.busy = false
    }
  }

  private listenHere(maker: RecogniserMaker): boolean {
    try {
      const recogniser = new maker()
      recogniser.continuous = true
      recogniser.interimResults = false

      recogniser.onresult = (event) => {
        for (let at = event.resultIndex; at < event.results.length; at++) {
          const result = event.results[at]
          if (!result?.isFinal) continue

          const said = result[0]?.transcript ?? ''
          if (said.trim()) {
            this.lastHeard = said
            this.nothing = false
            this.ears.heard({ said, ended: performance.now() })
            this.tell()
          }
        }
      }

      recogniser.onerror = (event) => {
        const why = event.error ?? 'unknown'
        if (why === 'no-speech' || why === 'aborted') return

        if (HOPELESS.has(why)) {
          this.hopeless = true
          this.dropRecogniser()
          this.wrong('the phone cannot listen', why)
          void this.listenThere()
          return
        }

        this.wrong('the phone could not listen', why)
      }

      recogniser.onend = () => {
        if (this.on && this.recogniser === recogniser) recogniser.start()
      }

      recogniser.start()
      this.recogniser = recogniser
      return true
    } catch (error) {
      this.hopeless = true
      this.trouble = 'the phone cannot listen'
      this.detail = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  private dropRecogniser(): void {
    const recogniser = this.recogniser
    this.recogniser = null
    if (!recogniser) return

    recogniser.onend = null
    recogniser.onresult = null
    recogniser.onerror = null
    try {
      recogniser.abort()
    } catch {
      // Aborting something that never started is not a failure worth a word.
    }
  }
}
