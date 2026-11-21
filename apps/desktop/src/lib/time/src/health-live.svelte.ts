import { invoke, isDesktop } from '../../platform/src/api'
import { healthStore } from './health-store.svelte'

export interface Monitor {
  id: string
  name: string | null
}
type State = 'off' | 'connecting' | 'connected' | 'reconnecting'
const MINUTE = 60_000
class LiveHeart {
  state = $state<State>('off')
  bpm = $state<number | null>(null)
  name = $state<string | null>(null)
  error = $state<string | null>(null)
  private heard: number[] = []
  private minute = 0
  private stop: (() => void) | null = null
  readonly can = isDesktop
  async monitors(): Promise<Monitor[]> {
    const said = await invoke<unknown>('hr_devices')
    if (!Array.isArray(said)) return []
    return said.flatMap((one: unknown) => {
      if (typeof one !== 'object' || one === null) return []
      const { id, name } = one as Record<string, unknown>
      return typeof id === 'string' ? [{ id, name: typeof name === 'string' && name ? name : null }] : []
    })
  }
  async connect(monitor: Monitor): Promise<void> {
    this.error = null
    this.state = 'connecting'
    this.name = monitor.name
    await this.listen()
    try {
      await invoke('hr_connect', { id: monitor.id })
      this.state = 'connected'
    } catch (error) {
      this.state = 'off'
      this.error = error instanceof Error ? error.message : String(error)
    }
  }
  async disconnect(): Promise<void> {
    this.flush()
    this.state = 'off'
    this.bpm = null
    this.stop?.()
    this.stop = null
    await invoke('hr_disconnect').catch(() => undefined)
  }
  heardBeat(bpm: number, at: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 250) return
    const minute = Math.floor(at / MINUTE) * MINUTE
    if (minute !== this.minute) this.flush()
    this.minute = minute
    this.heard.push(bpm)
    this.bpm = Math.round(bpm)
  }
  private flush(): void {
    if (!this.heard.length) return
    const value = this.heard.reduce((sum, one) => sum + one, 0) / this.heard.length
    this.heard = []
    void healthStore.keep([{ kind: 'heart', at: this.minute, value }]).catch(() => undefined)
  }
  private async listen(): Promise<void> {
    if (this.stop) return
    const { listen } = await import('@tauri-apps/api/event')
    const beats = await listen<{ bpm?: unknown; at?: unknown }>('orden://heart', (event) => {
      const { bpm, at } = event.payload
      if (typeof bpm === 'number') this.heardBeat(bpm, typeof at === 'number' ? at : Date.now())
    })
    const states = await listen<{ state?: unknown }>('orden://heart-state', (event) => {
      const said = event.payload.state
      if (said === 'connected' || said === 'reconnecting') this.state = said
      else if (said === 'stopped') this.state = 'off'
    })
    this.stop = () => {
      beats()
      states()
    }
  }
}
export const liveHeart = new LiveHeart()
