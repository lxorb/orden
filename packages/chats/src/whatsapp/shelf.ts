import type { AuthenticationCreds, SignalKeyStore } from '@whiskeysockets/baileys'
import type { Host } from '../provider'
import { secretName } from '../provider'
import type { Kit } from './client'

export const WHATSAPP = 'whatsapp'
const WAIT = 1000

type Kept = Record<string, Record<string, unknown> | undefined>

function base64Of(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

function bytesOfBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (one) => one.charCodeAt(0))
}

export function packed(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner instanceof Uint8Array) return { type: 'Buffer', data: base64Of(inner) }
    if (
      typeof inner === 'object' &&
      inner !== null &&
      (inner as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((inner as { data?: unknown }).data)
    )
      return {
        type: 'Buffer',
        data: base64Of(Uint8Array.from((inner as { data: number[] }).data)),
      }
    return inner
  })
}

export function unpacked(text: string, bytes: (data: Uint8Array) => Uint8Array): unknown {
  return JSON.parse(text, (_key, inner: unknown) => {
    if (
      typeof inner === 'object' &&
      inner !== null &&
      (inner as { type?: unknown }).type === 'Buffer'
    ) {
      const data = (inner as { data?: unknown }).data
      if (typeof data === 'string') return bytes(bytesOfBase64(data))
      if (Array.isArray(data)) return bytes(Uint8Array.from(data as number[]))
    }
    return inner
  })
}

export function authName(account: string): string {
  return secretName(WHATSAPP, account, 'auth')
}

export class Shelf {
  private name: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private dirty = false

  constructor(
    private readonly host: Host,
    private readonly kit: Pick<Kit, 'bytes' | 'revive'>,
    readonly creds: AuthenticationCreds,
    private readonly kept: Kept = {},
  ) {}

  static async read(
    host: Host,
    kit: Pick<Kit, 'bytes' | 'revive'>,
    account: string,
  ): Promise<Shelf | null> {
    const bytes = await host.sealed?.read(authName(account))
    if (!bytes) return null
    const found = unpacked(new TextDecoder().decode(bytes), kit.bytes) as {
      creds?: AuthenticationCreds
      keys?: Kept
    } | null
    if (!found?.creds) return null
    const shelf = new Shelf(host, kit, found.creds, found.keys ?? {})
    shelf.name = authName(account)
    return shelf
  }

  get keys(): SignalKeyStore {
    return {
      get: (type, ids) => {
        const found: Record<string, unknown> = {}
        const kind = this.kept[type] ?? {}
        for (const id of ids) {
          const value = kind[id]
          if (value !== undefined && value !== null) found[id] = this.kit.revive(type, value)
        }
        return Promise.resolve(found as never)
      },
      set: (data) => {
        for (const [type, values] of Object.entries(data)) {
          const kind: Record<string, unknown> = this.kept[type] ?? {}
          this.kept[type] = kind
          for (const [id, value] of Object.entries(values))
            kind[id] = value === null ? undefined : value
        }
        this.touch()
        return Promise.resolve()
      },
    }
  }

  credsChanged(update: Partial<AuthenticationCreds>): void {
    Object.assign(this.creds, update)
    this.touch()
  }

  keepAs(account: string): Promise<void> {
    this.name = authName(account)
    this.dirty = true
    return this.flush()
  }

  touch(): void {
    this.dirty = true
    if (!this.name || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, WAIT)
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const name = this.name
    const sealed = this.host.sealed
    if (!name || !sealed || !this.dirty) return this.writing
    this.dirty = false
    const bytes = new TextEncoder().encode(packed({ creds: this.creds, keys: this.kept }))
    this.writing = this.writing.then(
      () => sealed.write(name, bytes),
      () => sealed.write(name, bytes),
    )
    return this.writing
  }

  async forget(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.dirty = false
    const name = this.name
    this.name = null
    await this.writing.catch(() => undefined)
    if (name) await this.host.sealed?.write(name, null)
  }
}
