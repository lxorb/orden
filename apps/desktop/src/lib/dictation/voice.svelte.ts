import { message } from '../ui-kit/src/api'
import { settings } from '../settings.svelte'
import { engines } from './engines.svelte'
import type { Hooks, Listening } from './listening'
import type { Field } from './spot'

type Hearing = 'idle' | 'opening' | 'listening' | 'finishing'

export interface Dictates {
  field: () => Field | undefined
  words?: () => readonly string[]
  trouble?: (said: string) => void
}

class Voice {
  state = $state<Hearing>('idle')
  level = $state(0)
  owner = $state.raw<Dictates | null>(null)
  asking = $state.raw<Dictates | null>(null)

  private running: Listening | null = null
  private session: object | null = null
  private settling: Promise<void> | null = null
  private finishWhenOpen = false

  of(owner: Dictates): Hearing {
    return this.owner === owner ? this.state : 'idle'
  }

  async start(owner: Dictates): Promise<void> {
    if (this.owner === owner && this.state !== 'idle') return
    if (this.state !== 'idle') await this.finish()

    const engine = engines.now()
    if (!engine) {
      this.asking = owner
      return
    }
    const field = owner.field()
    if (!field) return

    const session = {}
    this.asking = null
    this.owner = owner
    this.session = session
    this.state = 'opening'
    this.finishWhenOpen = false
    const hooks: Hooks = {
      level: (level) => {
        if (this.session === session) this.level = level
      },
      full: () => {
        if (this.session === session) void this.finish()
      },
      ended: () => {
        if (this.session === session) this.reset()
      },
      trouble: (said) => this.say(owner, said),
    }
    try {
      const running =
        engine === 'device'
          ? await (await import('./device')).listenOnDevice(field, hooks)
          : await (await import('./listening')).listen(field, engine, owner.words?.() ?? [], hooks)
      if (!this.stillOpening(session)) {
        running.cancel()
        return
      }
      this.running = running
      this.state = 'listening'
      if (this.finishAsked()) void this.finish()
    } catch (error) {
      if (this.session === session) this.reset()
      this.say(owner, message(error, 'That microphone could not be opened.'))
    }
  }

  finish(): Promise<void> {
    if (this.state === 'opening') {
      this.finishWhenOpen = true
      return Promise.resolve()
    }
    if (this.state !== 'listening' || !this.running) return this.settling ?? Promise.resolve()

    this.state = 'finishing'
    this.level = 0
    const session = this.session
    this.settling = this.running.finish().finally(() => {
      if (this.session === session) this.reset()
    })
    return this.settling
  }

  cancel(): void {
    this.running?.cancel()
    this.reset()
  }

  toggle(owner: Dictates): Promise<void> {
    return this.of(owner) === 'idle' ? this.start(owner) : this.finish()
  }

  private stillOpening(session: object): boolean {
    return this.session === session && this.state === 'opening'
  }

  private finishAsked(): boolean {
    return this.finishWhenOpen
  }

  private reset(): void {
    this.state = 'idle'
    this.level = 0
    this.owner = null
    this.running = null
    this.session = null
    this.settling = null
  }

  private say(owner: Dictates, said: string): void {
    if (owner.trouble) owner.trouble(said)
    else settings.error = said
  }
}

export const voice = new Voice()
