/** Dictation through the device's own recogniser, the third road (#1128).
 *
 *  Android's `SpeechRecognizer` through the activity (Speech.kt), and the web's
 *  `SpeechRecognition` elsewhere - which on a Mac, an iPhone and an iPad is Apple's.
 *  Either one hears as it goes and says so: partial words while a sentence is under
 *  way, which are drawn as live words, and the sentence once it is sure, which stays.
 *  So there is no final pass to make here: finishing keeps what was said, and the last
 *  sentence as far as it got.
 *
 *  Weaker than Whisper at names and at two languages in one sentence, because it listens
 *  in one language, the app's; free, and nothing is asked of a key or an account. Where
 *  the sound goes is its maker's affair, which the chooser says. */

import { key } from '../i18n.svelte'
import { answer, frameWord, method } from '../mobile/bridge'
import type { Hooks, Listening } from './listening'
import { speechRecogniser } from './recogniser'
import { type Field, Spot } from './spot'

/** One thing a recogniser heard, as the web hands it over; written out because the DOM
 *  library has no types for the webkit spelling. */
interface Result {
  isFinal: boolean
  0?: { transcript: string }
}

interface Heard {
  results: ArrayLike<Result | undefined>
}

interface Recogniser {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: Heard) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** How long finishing waits for a web recogniser's last sentence before it keeps what
 *  it has. */
const LAST_WORDS = 1_500

/** How many times in a row a web recogniser may end on its own and be started again
 *  before it is taken to be one that will not work. */
const MOST_RESTARTS = 3

/** Starts the device's recogniser over a field. */
export async function listenOnDevice(field: Field, hooks: Hooks): Promise<Listening> {
  const session = new DeviceSession(field, hooks)
  await session.open()
  return { finish: () => session.finish(), cancel: () => session.cancel() }
}

/** Exported for its tests, which stand in for both recognisers. */
export class DeviceSession {
  private readonly spot: Spot
  /** The sentences the recogniser is sure of. */
  private sure: string[] = []
  private live = ''
  private over = false
  private web: Recogniser | null = null
  /** What earlier runs of a web recogniser were sure of, since each run starts its
   *  results again from nothing; and what the run under way is sure of. */
  private webDone: string[] = []
  private webNow = ''
  private restarts = 0
  private lastWords: (() => void) | null = null

  constructor(
    field: Field,
    private readonly hooks: Hooks,
  ) {
    this.spot = new Spot(field, () => this.brokenOff())
  }

  async open(): Promise<void> {
    try {
      if (method('listen')) await this.openPhone()
      else this.openWeb()
    } catch (error) {
      this.spot.release()
      throw error
    }
  }

  private async openPhone(): Promise<void> {
    const listen = method('listen')
    if (!listen) return
    answer('__nibHeard', (json: string) => this.phoneSaid(json))
    // The word only the page has: a microphone is not a thing a framed page turns on.
    const word = await frameWord()
    if (!word) throw new Error(key('That microphone could not be opened.'))
    listen(word, true)
  }

  /** What the activity heard, or what it is doing. */
  private phoneSaid(json: string): void {
    if (this.over) return
    let held: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(json)
      if (typeof parsed !== 'object' || parsed === null) return
      held = parsed as Record<string, unknown>
    } catch {
      return
    }

    if (typeof held.level === 'number') this.hooks.level(phoneLevel(held.level))
    if (typeof held.partial === 'string') this.heard(held.partial, false)
    if (typeof held.text === 'string' && held.text.trim()) this.heard(held.text, true)
    if (held.state === 'refused') {
      this.hooks.trouble(key('That microphone could not be opened.'))
      this.brokenOff()
    } else if (held.state === 'off') {
      // The recogniser gave up on its own: what it heard stays, as when it is finished.
      this.endedItself()
    }
  }

  private openWeb(): void {
    const makes = speechRecogniser() as (new () => Recogniser) | undefined
    if (!makes) throw new Error(key('That microphone could not be opened.'))
    const one = new makes()
    one.continuous = true
    one.interimResults = true
    one.lang = document.documentElement.lang || navigator.language || 'en'

    one.onresult = (event) => {
      this.restarts = 0
      let sure = ''
      let live = ''
      for (const result of Array.from(event.results)) {
        const words = result?.[0]?.transcript ?? ''
        if (result?.isFinal) sure += words
        else live += words
      }
      this.webHeard(sure, live)
    }
    one.onspeechstart = () => this.hooks.level(0.6)
    one.onspeechend = () => this.hooks.level(0)
    one.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.hooks.trouble(key('That microphone could not be opened.'))
        this.brokenOff()
      }
    }
    one.onend = () => {
      if (this.lastWords) {
        this.lastWords()
        return
      }
      if (this.over) return
      // A recogniser ends itself after a silence; while dictation is on it is started
      // again, and one that keeps ending at once is one that will not work.
      this.webDone.push(...this.webSure())
      if (++this.restarts > MOST_RESTARTS) {
        this.endedItself()
        return
      }
      try {
        one.start()
      } catch {
        this.endedItself()
      }
    }

    one.start()
    this.web = one
  }

  private webSure(): string[] {
    const was = this.webNow.trim()
    this.webNow = ''
    return was ? [was] : []
  }

  private webHeard(sure: string, live: string): void {
    this.webNow = sure
    this.sure = [...this.webDone, ...(sure.trim() ? [sure.trim()] : [])]
    this.live = live.trim()
    this.show()
  }

  /** A sentence heard: `sure` once the recogniser will not change it. */
  private heard(words: string, sure: boolean): void {
    if (sure) {
      this.sure.push(words.trim())
      this.live = ''
    } else {
      this.live = words.trim()
    }
    this.show()
  }

  private said(): string {
    return [...this.sure, this.live].filter(Boolean).join(' ')
  }

  private show(): void {
    if (!this.over) this.spot.show(this.said(), !!this.live)
  }

  /** Stops, and keeps what was heard, the last sentence as far as it got. A web
   *  recogniser is given a moment for the sentence it is still sure of. */
  async finish(): Promise<void> {
    if (this.over) return
    const one = this.web
    if (one) {
      await new Promise<void>((done) => {
        const timer = setTimeout(done, LAST_WORDS)
        this.lastWords = () => {
          clearTimeout(timer)
          done()
        }
        try {
          one.stop()
        } catch {
          done()
        }
      })
    }
    this.keep()
  }

  /** The recogniser stopped by itself: what it heard stays, and dictation is over. */
  private endedItself(): void {
    if (this.over) return
    this.keep()
    this.hooks.ended()
  }

  private keep(): void {
    if (this.over) return
    this.over = true
    this.stop()
    this.spot.show(this.said(), false)
    this.spot.release()
  }

  /** Stops, and puts the field back. */
  cancel(): void {
    if (this.over) return
    this.over = true
    this.stop()
    this.spot.restore()
    this.spot.release()
  }

  private stop(): void {
    this.hooks.level(0)
    const listen = method('listen')
    if (listen) {
      answer('__nibHeard', undefined)
      void frameWord().then((word) => listen(word, false))
    }
    if (this.web) {
      const one = this.web
      this.web = null
      one.onresult = null
      one.onend = null
      one.onerror = null
      try {
        one.abort()
      } catch {
        // Already stopped, which is where this wanted it.
      }
    }
  }

  private brokenOff(): void {
    if (this.over) return
    this.over = true
    this.stop()
    this.spot.release()
    this.hooks.ended()
  }
}

/** Android's level, a decibel figure from about -2 to 10, as the meter's nought to one. */
function phoneLevel(rms: number): number {
  return Math.min(1, Math.max(0, (rms + 2) / 12))
}
