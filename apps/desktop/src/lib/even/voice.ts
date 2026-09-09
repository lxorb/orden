/** Listening, and what was said.
 *
 *  Two ways, because the platform gives two and neither is available everywhere:
 *
 *  1. **The WebView's own recogniser**, on the *phone's* microphone. Android's
 *     WebView carries `webkitSpeechRecognition`, which hands over whole utterances
 *     with its own endpointing. Nothing to pay for, nothing to send anywhere, and
 *     the faster of the two, so it is preferred when it is there. iOS WKWebView has
 *     never had it. The manifest asks for `phone-microphone` for this path.
 *  2. **The glasses' own microphone**, under `g2-microphone`.
 *     `audioControl(true, glasses)` streams processed PCM through
 *     `onEvenHubEvent`. Nothing on the device will turn that into words, so an
 *     utterance is cut out of the stream here and sent to a transcription API with
 *     the account's own key.
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
interface Heard {
  said: string
  /** `performance.now()` at the end of the speech that produced it. */
  ended: number
}

/** What the voice needs from the world outside it. */
export interface Ears {
  /** Opens or closes the glasses' own microphone. */
  microphone: (open: boolean) => Promise<boolean>
  /** Whether anything could turn sound into words right now.
   *
   *  Asked rather than handed over, and that is the whole of one of the two bugs
   *  behind "voice mode simply doesn't work whatever I say": it used to be a
   *  function or null, decided once when the bridge came up. The key moved onto
   *  the account, so at that moment the settings had not arrived yet, the answer
   *  was always null, and the second path was dead for the whole sitting. */
  canTranscribe: () => boolean
  /** Turns one utterance of PCM into words, or null when it could not. */
  transcribe: (wav: Uint8Array<ArrayBuffer>) => Promise<string | null>
  /** What was heard, whichever path heard it. */
  heard: (heard: Heard) => void
  /** Something went wrong, in as few words as carry the reason. */
  failed: (why: string) => void
  /** Where the voice is now, for the phone to show. Called on every change, so a
   *  screenshot of the phone says which path is running and how far it got. */
  said?: (state: Listening) => void
}

/** What the voice is doing, in the few facts one screenshot has to answer with.
 *
 *  Emil cannot read a log off the glasses and neither can anybody else, so this is
 *  the evidence path: which way the plugin is listening, whether any sound has
 *  reached it, what it last made of that sound, and one line when something
 *  refused. Between them they name every step that can fail. */
export interface Listening {
  on: boolean
  path: Path
  /** Frames of sound since the microphone opened. Zero on the glasses path is the
   *  whole diagnosis: the microphone said yes and nothing is coming. */
  frames: number
  /** The last thing heard, or empty. */
  heard: string
  /** True when an utterance was sent and came back with no words at all. */
  nothing: boolean
  /** One short line when a path failed, in English, as a key the four
   *  dictionaries hold. This file has no locale in it, the same way shell.ts has
   *  none; see i18n.svelte.ts. */
  trouble: string
  /** Whatever the platform called it, beside that line and never translated: an
   *  error code is a name, and `network` said in German is still `network`. */
  detail: string
}

/** The recogniser errors that mean this WebView has no recogniser worth the name.
 *
 *  Chromium's `webkitSpeechRecognition` is *defined* in an Android WebView and
 *  reaches Google's own service to do the recognising, which an embedded WebView
 *  usually cannot: it answers `network` or `service-not-allowed` a moment after
 *  `start()` returned perfectly happily. So the constructor being there says
 *  nothing, and the plugin used to believe it and stop there. Any of these and the
 *  glasses' own microphone is opened instead, at once. */
const HOPELESS = new Set([
  'network',
  'service-not-allowed',
  'not-allowed',
  'audio-capture',
  'language-not-supported',
])

/** How long the glasses' microphone may be open with nothing arriving before the
 *  phone says so. Frames come fifty times a second, so two seconds of nothing is
 *  not a pause, it is a path that is not running. */
const NO_FRAMES = 2000

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
  /** True once a recogniser has shown it cannot recognise anything here. The
   *  constructor being on the page says nothing; this is what it actually did. */
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

  /** Which of the two paths this device has, as it stands.
   *
   *  Read afresh rather than decided once: a recogniser that has since refused is
   *  no recogniser, and whether there is a key is a question about the account,
   *  which arrives a moment after the plugin does. */
  get path(): Path {
    if (this.recogniser) return 'webview'
    if (!this.hopeless && recogniserOf()) return 'webview'
    return this.ears.canTranscribe() ? 'glasses' : 'none'
  }

  /** Everything a screenshot of the phone has to answer. */
  get state(): Listening {
    return {
      on: this.on,
      path: this.path,
      frames: this.frames,
      heard: this.lastHeard,
      nothing: this.nothing,
      trouble: this.trouble,
      detail: this.detail,
    }
  }

  private tell(): void {
    this.ears.said?.(this.state)
  }

  /** Something went wrong, said once in the foot and kept for the phone. */
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

  /** The glasses' own microphone. Also where the first path lands the moment it
   *  turns out not to work, which is what makes the fallback an order rather than
   *  a choice made once at the start. */
  private async listenThere(): Promise<boolean> {
    if (!this.ears.canTranscribe()) {
      // No recogniser and no key: there is nothing to listen with, and saying so
      // is better than a microphone that is on and deaf.
      this.on = false
      this.wrong('no recognition')
      return false
    }

    const opened = await this.ears.microphone(true)
    this.on = opened
    if (!opened) {
      this.wrong('no microphone')
      return false
    }

    // Frames come fifty times a second. If none has, something between the
    // permission and the radio is not running, and the phone says which.
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

  /** One frame of sound off the glasses, from `sdk.ts`. Ignored on the first path,
   *  where the microphone was never opened. */
  frame(pcm: Uint8Array): void {
    if (!this.on || this.recogniser) return

    // Counted before anything is decided about it: what a screenshot needs to
    // answer first is whether any sound arrived at all.
    const first = this.frames === 0
    this.frames++
    if (first) this.tell()

    const whole = this.utterance.hear(pcm, performance.now())
    if (!whole) return

    void this.transcribe(whole.pcm, whole.ended)
  }

  private async transcribe(pcm: Uint8Array, ended: number): Promise<void> {
    if (this.busy) return

    this.busy = true
    try {
      const said = await this.ears.transcribe(wavOf(pcm))
      // Sent, and nothing came back. Said rather than swallowed: an utterance that
      // reached the transcriber and came back empty is a different fault from one
      // that never reached it, and only the phone can tell anybody which.
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
        // Silence is not an error worth a word on the panel: the recogniser says
        // this every time the reader stops talking for a while.
        if (why === 'no-speech' || why === 'aborted') return

        // Anything else is this WebView saying it cannot do this. An embedded
        // WebView usually cannot: the recogniser reaches Google's own service and
        // answers `network` or `service-not-allowed` a moment after `start()` was
        // perfectly happy. So the glasses' microphone is opened instead, at once,
        // rather than the reader being left talking to a path that has given up.
        if (HOPELESS.has(why)) {
          this.hopeless = true
          this.dropRecogniser()
          this.wrong('the phone cannot listen', why)
          void this.listenThere()
          return
        }

        this.wrong('the phone could not listen', why)
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
      // A constructor that throws is the same finding as a fatal error, and the
      // same answer: this WebView has no recogniser, whatever is on the page.
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
