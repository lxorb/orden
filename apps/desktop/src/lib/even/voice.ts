/** Listening, and what was said.
 *
 *  Two ways, because the platform gives two and neither is available everywhere:
 *
 *  1. **The WebView's own recogniser.** Android's WebView carries
 *     `webkitSpeechRecognition`, which listens on the *phone's* microphone and
 *     hands over whole utterances with its own endpointing. Nothing to pay for,
 *     nothing to send anywhere, and the fastest of the two, so it is preferred
 *     when it is there. iOS WKWebView has never had it.
 *  2. **The glasses' own microphone.** `audioControl(true, glasses)` streams
 *     processed PCM through `onEvenHubEvent`. Nothing on the device will turn
 *     that into words, so an utterance is cut out of the stream here and sent to
 *     a transcription API with the account's own key.
 *
 *  The second path is the one that decides the shape of this file. A stream of
 *  sound has to be cut into utterances *before* anything can be transcribed, and
 *  where it is cut is where the latency of a command comes from: too eager and
 *  half a phrase is sent, too patient and every command waits for the pause.
 *  `QUIET` below is that number, and it is the one worth arguing about.
 *
 *  What this does not do is decide what a phrase means. That is `commands.ts`,
 *  which is a table and a couple of numbers and is why the second half of a
 *  command costs nothing measurable. */

/** The glasses' audio, as the host sends it: sixteen bit little endian at 16 kHz.
 *
 *  Not published by the platform. It is what the SDK's own audio path is built for
 *  and what the community's own notes report, and it is the one thing here that a
 *  device has to confirm: at the wrong rate an utterance is transcribed as
 *  gibberish rather than as nothing, which is the worst way to be wrong. */
const RATE = 16_000
const BYTES_PER_SAMPLE = 2

/** How long a stretch of quiet ends an utterance.
 *
 *  Six hundred milliseconds. Under about four hundred and the gap between "switch
 *  space" and "to work" ends the phrase; over about eight hundred and every
 *  command a reader gives waits noticeably after they have stopped talking. This
 *  is the whole of the latency the plugin itself adds on the second path, and it
 *  is deliberate rather than incidental. */
const QUIET = 600

/** How loud a frame has to be to count as speech, as a fraction of full scale.
 *
 *  Root mean square over the frame. The glasses' microphone is close to the mouth
 *  and its own processing has already taken the room out, so this can be low. */
const LOUD = 0.02

/** The longest an utterance can run before it is sent anyway. A reader who keeps
 *  talking is dictating a question, and eight seconds of it is plenty. */
const LONGEST = 8_000

/** The shortest that is worth sending. Below this it is a door closing. */
const SHORTEST = 250

/** What was heard, and when the speaking stopped.
 *
 *  `ended` is the whole point of the shape: the latency of a command is measured
 *  from the moment the reader stopped talking to the moment the panel changed, and
 *  only the thing that noticed the silence knows when that was. */
export interface Heard {
  said: string
  /** `performance.now()` at the end of the speech that produced it. */
  ended: number
}

/** What the voice needs from the world outside it. */
export interface Ears {
  /** Opens or closes the glasses' own microphone. */
  microphone: (open: boolean) => Promise<boolean>
  /** Turns one utterance of PCM into words, or null when it could not.
   *  `null` for a reader with no key set, which is also how the second path is
   *  told it cannot work. */
  transcribe: ((wav: Uint8Array) => Promise<string | null>) | null
  /** What was heard, whichever path heard it. */
  heard: (heard: Heard) => void
  /** Something went wrong, in as few words as carry the reason. */
  failed: (why: string) => void
}

/** The recogniser the WebView may or may not have. Only the parts used. */
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

/** The WebView's own recogniser, or null where there is none.
 *
 *  Read off the global rather than typed, because it is a vendor prefix on one
 *  platform and absent on the other, and because a page in a browser has it while
 *  a page in WKWebView does not. */
function recogniserOf(): RecogniserMaker | null {
  const window_ = globalThis as {
    SpeechRecognition?: RecogniserMaker
    webkitSpeechRecognition?: RecogniserMaker
  }

  return window_.SpeechRecognition ?? window_.webkitSpeechRecognition ?? null
}

/** A RIFF WAVE header, and the samples after it.
 *
 *  Every transcription API takes a file rather than a stream, and a WAV is the
 *  cheapest file there is: forty four bytes in front of the samples that already
 *  arrived. Nothing is re-sampled and nothing is re-encoded, so a phrase costs one
 *  allocation and no arithmetic at all. */
export function wavOf(pcm: Uint8Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const ascii = (at: number, text: string) => {
    for (let n = 0; n < text.length; n++) out[at + n] = text.charCodeAt(n)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // the size of this chunk
  view.setUint16(20, 1, true) // PCM, uncompressed
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * BYTES_PER_SAMPLE, true) // bytes a second
  view.setUint16(32, BYTES_PER_SAMPLE, true) // bytes a frame
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true) // bits a sample
  ascii(36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)

  return out
}

/** How loud a frame of sixteen bit samples is, from zero to one. */
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

/** How many milliseconds of sound a run of bytes is. */
function millisOf(bytes: number, rate = RATE): number {
  return (bytes / BYTES_PER_SAMPLE / rate) * 1000
}

/** An utterance being gathered out of the stream.
 *
 *  Pure, and separate from the microphone on purpose: where a phrase begins and
 *  ends is the one thing here worth testing, and it can be tested by handing it
 *  frames of numbers. */
export class Utterance {
  private frames: Uint8Array[] = []
  private held = 0
  private quiet = 0
  private speaking = false

  /** One frame in. Answers the utterance when this frame ended it, else null.
   *
   *  `now` is handed in rather than read, so that a test can hand it a clock and a
   *  device can hand it the real one. */
  hear(pcm: Uint8Array, now: number): { pcm: Uint8Array; ended: number } | null {
    const loud = loudnessOf(pcm) >= LOUD

    if (loud) {
      if (!this.speaking) {
        this.speaking = true
        this.frames = []
        this.held = 0
      }
      this.quiet = 0
    } else if (!this.speaking) {
      // Silence with nothing before it: nothing to keep.
      return null
    } else {
      this.quiet += millisOf(pcm.length)
    }

    this.frames.push(pcm)
    this.held += pcm.length

    const spoken = millisOf(this.held)
    const done = this.quiet >= QUIET || spoken >= LONGEST
    if (!done) return null

    const whole = this.take()
    // The silence at the end is not speech, and a transcriber charges for it.
    if (millisOf(whole.length) - this.quiet < SHORTEST) {
      this.reset()
      return null
    }

    // The end of the speech, which is where the silence began rather than where it
    // was noticed. That is what a latency has to be measured from.
    const ended = now - this.quiet
    this.reset()
    return { pcm: whole, ended }
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
  }
}

/** Which way the plugin is listening. Said out loud because it decides what a
 *  command costs, and the report has to name it. */
export type Path = 'webview' | 'glasses' | 'none'

export class Voice {
  private on = false
  private recogniser: Recogniser | null = null
  private readonly utterance = new Utterance()
  /** One transcription in flight. A second utterance while the first is still
   *  being transcribed is dropped rather than queued: a command the reader gave
   *  two seconds ago is not one they still want. */
  private busy = false

  constructor(private readonly ears: Ears) {}

  get listening(): boolean {
    return this.on
  }

  /** Which of the two paths this device has, before anything is opened. */
  get path(): Path {
    if (recogniserOf()) return 'webview'
    return this.ears.transcribe ? 'glasses' : 'none'
  }

  async start(): Promise<boolean> {
    if (this.on) return true

    const maker = recogniserOf()
    if (maker) {
      const ok = this.listenHere(maker)
      this.on = ok
      return ok
    }

    if (!this.ears.transcribe) {
      // No recogniser and no key: there is nothing to listen with, and saying so
      // is better than a microphone that is on and deaf.
      this.ears.failed('no recognition')
      return false
    }

    const opened = await this.ears.microphone(true)
    this.on = opened
    if (!opened) this.ears.failed('no microphone')
    return opened
  }

  async stop(): Promise<void> {
    if (!this.on) return

    this.on = false
    const recogniser = this.recogniser
    this.recogniser = null
    if (recogniser) {
      recogniser.onend = null
      recogniser.abort()
      return
    }

    await this.ears.microphone(false)
  }

  /** One frame of sound off the glasses, from `sdk.ts`. Ignored on the first path,
   *  where the microphone was never opened. */
  frame(pcm: Uint8Array): void {
    if (!this.on || this.recogniser) return

    const whole = this.utterance.hear(pcm, performance.now())
    if (!whole) return

    void this.transcribe(whole.pcm, whole.ended)
  }

  private async transcribe(pcm: Uint8Array, ended: number): Promise<void> {
    const transcribe = this.ears.transcribe
    if (!transcribe || this.busy) return

    this.busy = true
    try {
      const said = await transcribe(wavOf(pcm))
      if (said) this.ears.heard({ said, ended })
    } catch (error) {
      this.ears.failed(error instanceof Error ? error.message : String(error))
    } finally {
      this.busy = false
    }
  }

  /** The WebView's own recogniser, which does its own endpointing and hands over
   *  whole utterances. */
  private listenHere(maker: RecogniserMaker): boolean {
    try {
      const recogniser = new maker()
      recogniser.continuous = true
      // Only the final ones: an interim result is a guess that changes under us,
      // and acting on a guess turns a page nobody asked for.
      recogniser.interimResults = false

      recogniser.onresult = (event) => {
        for (let at = event.resultIndex; at < event.results.length; at++) {
          const result = event.results[at]
          if (!result?.isFinal) continue

          const said = result[0]?.transcript ?? ''
          // The recogniser has already waited out the pause, so as far as this
          // path is concerned the speech ended when the words arrived.
          if (said.trim()) this.ears.heard({ said, ended: performance.now() })
        }
      }

      recogniser.onerror = (event) => {
        const why = event.error ?? 'unknown'
        // Silence is not an error worth a word on the panel: the recogniser says
        // this every time the reader stops talking for a while.
        if (why !== 'no-speech' && why !== 'aborted') this.ears.failed(`voice: ${why}`)
      }

      // Continuous is a promise the platform does not keep: it stops on its own
      // after a stretch of quiet, so it is started again for as long as the reader
      // asked to be listened to.
      recogniser.onend = () => {
        if (this.on && this.recogniser === recogniser) recogniser.start()
      }

      recogniser.start()
      this.recogniser = recogniser
      return true
    } catch (error) {
      this.ears.failed(error instanceof Error ? error.message : String(error))
      return false
    }
  }
}
