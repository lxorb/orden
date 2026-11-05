/** Dictation heard on this computer (#1151): whether it can, the model it downloads, how
 *  far a download has come, and how fast it heard here.
 *
 *  Asked of the app once, the first time anything wants to know (src-tauri/src/
 *  dictation.rs), and only on a desktop: a phone has no runtime to download. The model is
 *  fetched only when the reader turns this on, and removed from Settings. */

import { key, message } from '../i18n.svelte'
import { forget, keep, storedText } from '../stored'
import { invoke, isDesktop } from '../tauri'

/** Why a device cannot hear on its own, as the app says it. */
type Fit = 'fits' | 'platform' | 'cores' | 'memory'

/** What the app says about this device and its model. */
interface Machine {
  fit: Fit
  model: { id: string; name: string; bytes: number }
  installed: boolean
}

/** How far a download has come, in bytes. */
interface Fetched {
  done: number
  total: number
}

/** Seconds of work per second of sound, as the open model measured itself. */
const PACE = 'nib:dictation-local-pace'

/** The slowest pace "Auto" still hears on this computer at: a four-second stretch, the
 *  shortest a pause ends, heard again within 1.2 s. Slower than that, the live words
 *  trail the voice further than the network's do. */
export const KEEPS_UP = 0.3

function keptPace(): number | null {
  const kept = Number(storedText(PACE))
  return Number.isFinite(kept) && kept > 0 ? kept : null
}

class Local {
  /** What the app said, once it has. */
  machine = $state.raw<Machine | null>(null)
  fetching = $state.raw<Fetched | null>(null)
  trouble = $state('')
  /** How fast this computer heard the last time the model was opened. */
  pace = $state<number | null>(keptPace())

  private asked: Promise<void> | null = null

  /** Asks the app, once. */
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

  /** Whether this computer can hear on its own, downloaded or not. Unknown until asked,
   *  and asked by this. */
  get fits(): boolean {
    void this.ask()
    return this.machine?.fit === 'fits'
  }

  get ready(): boolean {
    return this.fits && !!this.machine?.installed
  }

  /** Whether the model, once here, hears fast enough here for "Auto" to choose it. */
  get keepsUp(): boolean {
    return this.pace === null || this.pace <= KEEPS_UP
  }

  /** Downloads the model, where it is not here and not on its way. */
  async fetch(): Promise<void> {
    if (this.fetching || this.ready || !this.fits) return
    this.fetching = { done: 0, total: this.machine?.model.bytes ?? 0 }
    this.trouble = ''
    try {
      const { Channel } = await import('../native')
      const progress = new Channel<Fetched>()
      progress.onmessage = (fetched) => (this.fetching = fetched)
      await invoke('dictation_local_fetch', { progress })
      if (this.machine) this.machine = { ...this.machine, installed: true }
    } catch (error) {
      this.trouble = message(error, key('The speech model could not be downloaded.'))
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

  /** Opens the model for a dictation, and keeps how fast it heard. */
  async open(): Promise<void> {
    const opened = await invoke<{ pace: number }>('dictation_local_open')
    this.pace = opened.pace
    keep(PACE, String(opened.pace))
  }
}

export const local = new Local()
