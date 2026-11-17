import { message } from '../../ui-kit/src/api'
import { forget, keep, storedText, invoke, isDesktop } from '../../platform/src/api'

type Fit = 'fits' | 'platform' | 'cores' | 'memory'

interface Machine {
  fit: Fit
  model: { id: string; name: string; bytes: number }
  installed: boolean
}

interface Fetched {
  done: number
  total: number
}

const PACE = 'orden:dictation-local-pace'

export const KEEPS_UP = 0.3

function keptPace(): number | null {
  const kept = Number(storedText(PACE))
  return Number.isFinite(kept) && kept > 0 ? kept : null
}

class Local {
  machine = $state.raw<Machine | null>(null)
  fetching = $state.raw<Fetched | null>(null)
  trouble = $state('')
  pace = $state<number | null>(keptPace())

  private asked: Promise<void> | null = null

  ask(): Promise<void> {
    if (!isDesktop) return Promise.resolve()
    this.asked ??= invoke<Machine>('dictation_local').then(
      (machine) => {
        this.machine = machine
      },
      () => undefined,
    )
    return this.asked
  }

  get fits(): boolean {
    void this.ask()
    return this.machine?.fit === 'fits'
  }

  get ready(): boolean {
    return this.fits && !!this.machine?.installed
  }

  get keepsUp(): boolean {
    return this.pace === null || this.pace <= KEEPS_UP
  }

  async fetch(): Promise<void> {
    if (this.fetching || this.ready || !this.fits) return
    this.fetching = { done: 0, total: this.machine?.model.bytes ?? 0 }
    this.trouble = ''
    try {
      const { Channel } = await import('../../crate/src/api')
      const progress = new Channel<Fetched>()
      progress.onmessage = (fetched) => (this.fetching = fetched)
      await invoke('dictation_local_fetch', { progress })
      if (this.machine) this.machine = { ...this.machine, installed: true }
    } catch (error) {
      this.trouble = message(error, 'The speech model could not be downloaded.')
    } finally {
      this.fetching = null
    }
  }

  async remove(): Promise<void> {
    await invoke('dictation_local_remove')
    if (this.machine) this.machine = { ...this.machine, installed: false }
    this.pace = null
    forget(PACE)
  }

  async open(): Promise<void> {
    const opened = await invoke<{ pace: number }>('dictation_local_open')
    this.pace = opened.pace
    keep(PACE, String(opened.pace))
  }
}

export const local = new Local()
