import { type Usage, usageOf } from '@orden/online/apps'
import type { DownReason, ImageKind } from '@orden/online/wire'
import { Channel } from '../native'
import { isNumber, isRecord } from '../stored'
import { invoke } from '../tauri'
import type { Destination } from '../remote/hosts'
import { hostIdOf } from './spec'

export type Machine = 'awake' | 'starting' | 'asleep' | 'stopping' | 'down' | 'near'

export type Said =
  | { out: Uint8Array }
  | { exit: number | null }
  | {
      screen: string
      cols: number
      rows: number
      restored: { at: number; program: string | null } | null
    }
  | { size: { cols: number; rows: number } }
  | { program: string | null; title: string | null }
  | { machine: Machine; reason?: DownReason }
  | { connected: boolean }
  | { link: boolean }
  | { typing: boolean }
  | { refused: string; gone?: boolean }
  | { note: string }
  | { held: { by: string; since: number; taken: boolean } | null }

export interface Source {
  readonly remote: boolean
  start(cols: number, rows: number, said: (what: Said) => void): Promise<void>
  write(data: string, binary: boolean): Promise<void>
  resize(cols: number, rows: number): void
  seen(bytes: number): void
  end(): void
  again?(): void
  take?(): void
  image?(bytes: Uint8Array, kind: ImageKind): Promise<string>
  usage?(): Promise<Usage | null>
}

export class PtySource implements Source {
  readonly remote: boolean
  reached: string | null = null

  constructor(
    readonly id: string,
    private readonly shell: string,
    private readonly folder: string | null,
    remote: boolean,
  ) {
    this.remote = remote
  }

  async usage(): Promise<Usage | null> {
    return usageOf(await invoke<unknown>('pty_usage', { id: this.id }).catch(() => null))
  }

  async start(cols: number, rows: number, said: (what: Said) => void): Promise<void> {
    const output = new Channel<unknown>()
    output.onmessage = (message) => {
      if (message instanceof ArrayBuffer) said({ out: new Uint8Array(message) })
      else if (isRecord(message) && isNumber(message.exit)) said({ exit: message.exit })
    }
    await invoke('pty_spawn', {
      id: this.id,
      shell: this.shell,
      folder: this.folder,
      cols,
      rows,
      output,
    })
  }

  async write(data: string, binary: boolean): Promise<void> {
    await invoke('pty_write', { id: this.id, data, binary }).catch(() => undefined)
  }

  resize(cols: number, rows: number): void {
    void invoke('pty_resize', { id: this.id, cols, rows }).catch(() => undefined)
  }

  seen(bytes: number): void {
    void invoke('pty_seen', { id: this.id, bytes }).catch(() => undefined)
  }

  end(): void {
    void invoke('pty_kill', { id: this.id }).catch(() => undefined)
  }

  async image(bytes: Uint8Array, kind: ImageKind): Promise<string> {
    const host = this.reached ?? hostIdOf(this.shell)
    if (host === null) return invoke<string>('local_image', { kind, bytes })
    return invoke<string>('remote_image', { host, kind, bytes })
  }

  async program(): Promise<string | null | undefined> {
    const found = await invoke<unknown>('pty_program', { id: this.id }).catch(() => undefined)
    if (found === undefined) return undefined
    return typeof found === 'string' && found ? found : null
  }

  async ssh(): Promise<Destination | null> {
    const found = await invoke<unknown>('pty_ssh', { id: this.id }).catch(() => null)
    if (!isRecord(found) || typeof found.hostname !== 'string' || !found.hostname) return null
    return {
      hostname: found.hostname,
      user: typeof found.user === 'string' && found.user ? found.user : null,
      port: isNumber(found.port) ? found.port : null,
    }
  }

  async busy(): Promise<boolean> {
    return (await invoke<unknown>('pty_busy', { id: this.id }).catch(() => true)) !== false
  }

  async where(): Promise<string | null> {
    const folder = await invoke<unknown>('pty_folder', { id: this.id }).catch(() => null)
    return typeof folder === 'string' && folder ? folder : null
  }
}
