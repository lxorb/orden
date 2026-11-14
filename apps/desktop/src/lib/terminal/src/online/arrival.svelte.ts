import type { DownReason } from '@orden/online/wire'
import type { Machine } from '../source'
import { heldLine, type Holder } from '../../../online-link/src/api'
import { refusalWords } from './words'

export const PATIENCE = 45_000
export const BOOT_PATIENCE = 3 * 60_000

type Waiting = 'connecting' | 'starting' | 'restoring'

export type Status =
  { waiting: Waiting } | { failed: string; gone?: true } | { held: string; taken: boolean }

interface Clock {
  after(ms: number, run: () => void): () => void
}

const timers: Clock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}

export function statusLine(status: Status): string {
  if ('failed' in status) return status.failed
  if ('held' in status) return status.held
  switch (status.waiting) {
    case 'starting':
      return 'Starting machine…'
    case 'restoring':
      return 'Restoring…'
    case 'connecting':
      return 'Connecting…'
  }
}

function downWords(reason: DownReason | undefined): string {
  const refused =
    reason === 'allowance' || reason === 'budget' || reason === 'off' || reason === 'flag'
  return (refused ? refusalWords(reason) : null) ?? 'Your machine could not start'
}

export class Arrival {
  failure = $state<string | null>(null)
  gone = $state(false)
  holder = $state<Holder | null>(null)
  private linked = $state(false)
  private state = $state<Machine | null>(null)
  private booted = $state(false)
  private relinking = $state(false)
  private here = false
  private giveUp: (() => void) | null = null

  constructor(private readonly clock: Clock = timers) {}

  get status(): Status {
    if (this.holder !== null) return { held: heldLine(this.holder), taken: this.holder.taken }
    if (this.failure !== null)
      return this.gone ? { failed: this.failure, gone: true } : { failed: this.failure }
    if (this.relinking) return { waiting: 'connecting' }
    if (this.linked && this.state === 'starting') return { waiting: 'starting' }
    if (this.linked && this.booted) return { waiting: 'restoring' }
    return { waiting: 'connecting' }
  }

  begin(): void {
    this.failure = null
    this.gone = false
    this.linked = false
    this.state = null
    this.booted = false
    this.relinking = false
    this.here = false
    this.holder = null
    this.wait()
  }

  held(holder: Holder): void {
    this.stop()
    this.here = false
    this.failure = null
    this.gone = false
    this.holder = holder
  }

  unheld(): void {
    if (this.holder === null) return
    this.holder = null
    this.wait()
  }

  relink(down: boolean): void {
    this.relinking = down
    this.heard()
  }

  linkedNow(open: boolean): void {
    this.linked = open
    if (!open) {
      this.here = false
      this.holder = null
    }
    this.heard()
  }

  machine(state: Machine, reason?: DownReason): void {
    this.state = state
    if (state === 'starting') this.booted = true
    else if (state === 'asleep' && this.booted && !this.here) {
      this.booted = false
      this.fail(downWords(reason))
      return
    }
    this.heard()
  }

  lost(): void {
    this.here = false
    this.booted = false
    this.failure = null
    this.gone = false
    this.wait()
  }

  fail(words: string, gone = false): void {
    this.stop()
    this.failure = words || (refusalWords('other') ?? '')
    this.gone = gone
  }

  heard(): void {
    if (!this.here && this.failure === null && this.holder === null) this.wait()
  }

  arrived(): void {
    this.here = true
    this.booted = false
    this.stop()
    this.failure = null
    this.gone = false
    this.holder = null
  }

  stop(): void {
    this.giveUp?.()
    this.giveUp = null
  }

  private wait(): void {
    this.stop()
    const patience = this.booted ? BOOT_PATIENCE : PATIENCE
    this.giveUp = this.clock.after(patience, () => {
      this.giveUp = null
      this.fail(refusalWords('other') ?? '')
    })
  }
}
