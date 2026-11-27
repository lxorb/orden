import { Channel } from '../../crate/src/api'
import { invoke } from '../../platform/src/api'

export type Trouble = 'offline' | 'disk_full' | 'checksum' | 'http' | 'cancelled' | 'busy' | 'failed'
export interface EngineStatus {
  version: string
  installed: boolean
  usable: boolean
  bytes: number
  source: string
  background: boolean
  downloading: boolean
}
type Heard =
  | { type: 'progress'; received: number; total: number }
  | { type: 'done'; version: string }
  | { type: 'failed'; kind: Trouble; detail: string }
const TROUBLES: readonly Trouble[] = ['offline', 'disk_full', 'checksum', 'http', 'cancelled', 'busy', 'failed']
const LINES: Record<Trouble, string> = {
  offline: 'No connection. Try again.',
  cancelled: 'Download stopped.',
  disk_full: 'Not enough disk space.',
  checksum: 'The download was damaged.',
  http: 'Download unavailable. Try later.',
  busy: 'Download unavailable. Try later.',
  failed: 'Download unavailable. Try later.',
}
export function stoppedLine(trouble: Trouble): string {
  return LINES[trouble]
}
function troubleOf(said: unknown): Trouble {
  const kind = typeof said === 'object' && said !== null ? (said as { kind?: unknown }).kind : null
  return TROUBLES.find((one) => one === kind) ?? 'failed'
}
class Engine {
  status = $state<EngineStatus | null>(null)
  received = $state<number | null>(null)
  trouble = $state<Trouble | null>(null)
  get usable(): boolean {
    return this.status?.usable === true
  }
  get going(): boolean {
    return this.received !== null && this.trouble === null
  }
  private listening = false
  async look(): Promise<void> {
    if (!this.listening) {
      this.listening = true
      const { listen } = await import('@tauri-apps/api/event')
      await listen<Heard>('opencode-engine', (event) => this.heard(event.payload))
    }
    this.status = await invoke<EngineStatus>('opencode_engine')
    if (this.status.downloading && this.received === null) this.received = 0
  }
  heard(said: Heard): void {
    if (said.type === 'progress') {
      this.received = said.received
      this.trouble = null
    } else if (said.type === 'done') {
      this.received = null
      this.trouble = null
      void this.look()
    } else {
      this.trouble = troubleOf(said)
    }
  }
  async download(): Promise<void> {
    if (this.going) return
    this.trouble = null
    this.received = 0
    try {
      if (this.status?.background !== true) await invoke('opencode_background', { on: true })
      const events = new Channel<Heard>()
      events.onmessage = (said) => this.heard(said)
      await invoke('opencode_download', { events })
    } catch (error) {
      const trouble = troubleOf(error)
      if (trouble !== 'busy') this.trouble = trouble
    }
    await this.look().catch(() => undefined)
  }
  cancel(): Promise<void> {
    return invoke('opencode_download_cancel')
  }
}
export const engine = new Engine()
