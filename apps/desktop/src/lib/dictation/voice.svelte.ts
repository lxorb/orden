/** Dictation, as every field that offers it sees it (#1128): one microphone, so one
 *  dictation at a time, and which field it is writing into.
 *
 *  What a field draws is read here - whether it is listening, how loud, whether the
 *  engine is being asked for - and what it does is asked here: start, finish, cancel.
 *  The work itself, the microphone, the passes and the words into the field, is
 *  listening.ts, fetched by the first press: a field carries a button and a key, and
 *  none of what turns a voice into words until somebody speaks. */

import { key, message } from '../i18n.svelte'
import { settings } from '../settings.svelte'
import { engines } from './engines.svelte'
import type { Hooks, Listening } from './listening'
import type { Field } from './spot'

/** Idle; the microphone being opened; listening; and the final pass being heard. */
type Hearing = 'idle' | 'opening' | 'listening' | 'finishing'

/** A field that takes dictation, as its host describes it. */
export interface Dictates {
  field: () => Field | undefined
  /** Names around the field - a thread's title, the note in front, a task's note - that
   *  the words are likely to contain. */
  words?: () => readonly string[]
  /** Where a failure is said. The app's own error line where a host has none. */
  trouble?: (said: string) => void
}

class Voice {
  state = $state<Hearing>('idle')
  /** How loud the voice is now, nought to one, for the meter. */
  level = $state(0)
  /** The field being written into. Raw, because a field is told apart by identity and
   *  a proxy of it is not the field. */
  owner = $state.raw<Dictates | null>(null)
  /** The field whose press is asking which engine to use. */
  asking = $state.raw<Dictates | null>(null)

  private running: Listening | null = null
  private settling: Promise<void> | null = null
  private finishWhenOpen = false

  /** What dictation is doing for one field: idle for every field but its own. */
  of(owner: Dictates): Hearing {
    return this.owner === owner ? this.state : 'idle'
  }

  /** Starts listening into a field. With no engine chosen yet it asks instead, and
   *  nothing is opened until the reader has answered. */
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

    this.asking = null
    this.owner = owner
    this.state = 'opening'
    this.finishWhenOpen = false
    const hooks: Hooks = {
      level: (level) => (this.level = level),
      full: () => void this.finish(),
      ended: () => {
        if (this.owner === owner) this.reset()
      },
      trouble: (said) => this.say(owner, said),
    }
    try {
      const running =
        engine === 'device'
          ? await (await import('./device')).listenOnDevice(field, hooks)
          : await (await import('./listening')).listen(field, engine, owner.words?.() ?? [], hooks)
      if (!this.stillOpening(owner)) {
        running.cancel()
        return
      }
      this.running = running
      this.state = 'listening'
      if (this.finishAsked()) void this.finish()
    } catch (error) {
      if (this.owner === owner) this.reset()
      this.say(owner, message(error, key('That microphone could not be opened.')))
    }
  }

  /** Stops listening and writes the final words. Resolves once they are in the field. */
  finish(): Promise<void> {
    if (this.state === 'opening') {
      this.finishWhenOpen = true
      return Promise.resolve()
    }
    if (this.state !== 'listening' || !this.running) return this.settling ?? Promise.resolve()

    this.state = 'finishing'
    this.level = 0
    const running = this.running
    this.settling = running.finish().finally(() => this.reset())
    return this.settling
  }

  /** Stops listening and puts the field back as it was before. */
  cancel(): void {
    this.running?.cancel()
    this.reset()
  }

  /** On, or off again. */
  toggle(owner: Dictates): Promise<void> {
    return this.of(owner) === 'idle' ? this.start(owner) : this.finish()
  }

  /** Whether the microphone being opened is still wanted, asked after the wait: a
   *  cancel or another field may have come in meanwhile. */
  private stillOpening(owner: Dictates): boolean {
    return this.owner === owner && this.state === 'opening'
  }

  /** Whether a finish was asked for while the microphone was being opened. */
  private finishAsked(): boolean {
    return this.finishWhenOpen
  }

  private reset(): void {
    this.state = 'idle'
    this.level = 0
    this.owner = null
    this.running = null
    this.settling = null
  }

  private say(owner: Dictates, said: string): void {
    if (owner.trouble) owner.trouble(said)
    else settings.error = said
  }
}

export const voice = new Voice()
