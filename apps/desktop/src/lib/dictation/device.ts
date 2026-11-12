import { answer, frameWord, method } from '../mobile/bridge'
import type { Hooks, Listening } from './listening'
import { speechRecogniser } from './recogniser'
import { type Field, Spot } from './spot'
import { systemLocale } from '../region'

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

const LAST_WORDS = 1_500

const MOST_RESTARTS = 3

export async function listenOnDevice(field: Field, hooks: Hooks): Promise<Listening> {
  const session = new DeviceSession(field, hooks)
  await session.open()
  return { finish: () => session.finish(), cancel: () => session.cancel() }
}

export class DeviceSession {
  private readonly spot: Spot
  private sure: string[] = []
  private live = ''
  private over = false
  private web: Recogniser | null = null
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
    answer('__ordenHeard', (json: string) => this.phoneSaid(json))
    const word = await frameWord()
    if (!word) throw new Error('That microphone could not be opened.')
    listen(word, true)
  }

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
      this.hooks.trouble('That microphone could not be opened.')
      this.brokenOff()
    } else if (held.state === 'off') {
      this.endedItself()
    }
  }

  private openWeb(): void {
    const makes = speechRecogniser() as (new () => Recogniser) | undefined
    if (!makes) throw new Error('That microphone could not be opened.')
    const one = new makes()
    one.continuous = true
    one.interimResults = true
    one.lang = systemLocale()

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
        this.hooks.trouble('That microphone could not be opened.')
        this.brokenOff()
      }
    }
    one.onend = () => {
      if (this.lastWords) {
        this.lastWords()
        return
      }
      if (this.over) return
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
      answer('__ordenHeard', undefined)
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

function phoneLevel(rms: number): number {
  return Math.min(1, Math.max(0, (rms + 2) / 12))
}
