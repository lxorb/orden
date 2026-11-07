import type { WAMessage } from '@whiskeysockets/baileys'
import type { Host } from '../provider'
import { secretName } from '../provider'
import type { Kit } from './client'
import { packed, unpacked, WHATSAPP } from './shelf'

const WAIT = 15_000
const PER_CHAT = 300
const MOST = 30_000

export interface ChatRow {
  id: string
  name?: string
  unread: number
  lastAt: number | null
  archived?: boolean
  pinned?: boolean
  muteEnd?: number | null
  readOnly?: boolean
  ephemeral?: number
  markedUnread?: boolean
  pins?: string[]
}

export interface ContactRow {
  id: string
  name?: string
  notify?: string
  verifiedName?: string
  lid?: string
  phone?: string
}

interface GroupMember {
  id: string
  admin?: 'admin' | 'superadmin' | null
}

export interface GroupRow {
  id: string
  subject: string
  desc?: string
  participants: GroupMember[]
  announce?: boolean
  community?: boolean
  parent?: string
}

export function secondsOf(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  if (typeof value === 'object' && value !== null) {
    const long = value as { toNumber?: () => number; low?: number; high?: number }
    if (typeof long.toNumber === 'function') return long.toNumber()
    if (typeof long.low === 'number') return (long.high ?? 0) * 2 ** 32 + (long.low >>> 0)
  }
  return 0
}

export function atOf(message: WAMessage): number {
  return secondsOf(message.messageTimestamp) * 1000
}

export function cacheName(account: string): string {
  return secretName(WHATSAPP, account, 'cache')
}

interface Packed {
  chats?: ChatRow[]
  contacts?: ContactRow[]
  groups?: GroupRow[]
  messages?: Record<string, string[]>
}

function base64Of(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

export class Cache {
  readonly chats = new Map<string, ChatRow>()
  readonly contacts = new Map<string, ContactRow>()
  readonly groups = new Map<string, GroupRow>()
  private readonly messages = new Map<string, WAMessage[]>()
  private name: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private dirty = false

  constructor(
    private readonly host: Host,
    private readonly kit: Pick<Kit, 'encode' | 'decode' | 'bytes'>,
  ) {}

  async load(account: string): Promise<void> {
    this.name = cacheName(account)
    const bytes = await this.host.sealed?.read(this.name).catch(() => null)
    if (!bytes) return
    let found: Packed
    try {
      found = unpacked(new TextDecoder().decode(bytes), this.kit.bytes) as Packed
    } catch {
      return
    }
    for (const one of found.chats ?? []) if (!this.chats.has(one.id)) this.chats.set(one.id, one)
    for (const one of found.contacts ?? [])
      if (!this.contacts.has(one.id)) this.contacts.set(one.id, one)
    for (const one of found.groups ?? []) if (!this.groups.has(one.id)) this.groups.set(one.id, one)
    for (const [jid, list] of Object.entries(found.messages ?? {})) {
      for (const text of list) {
        try {
          this.put(
            this.kit.decode(Uint8Array.from(atob(text), (one) => one.charCodeAt(0))),
            jid,
            false,
          )
        } catch {
          continue
        }
      }
    }
  }

  keepAs(account: string): Promise<void> {
    this.name = cacheName(account)
    this.dirty = true
    return this.flush()
  }

  list(jid: string): readonly WAMessage[] {
    return this.messages.get(jid) ?? []
  }

  chatsWithMessages(): IterableIterator<[string, WAMessage[]]> {
    return this.messages.entries()
  }

  find(jid: string, id: string): WAMessage | undefined {
    return this.list(jid).find((one) => one.key.id === id)
  }

  findAnywhere(id: string): WAMessage | undefined {
    for (const list of this.messages.values()) {
      const found = list.find((one) => one.key.id === id)
      if (found) return found
    }
    return undefined
  }

  put(message: WAMessage, jid = message.key.remoteJid ?? '', touch = true): 'new' | 'changed' {
    const list = this.messages.get(jid) ?? []
    const id = message.key.id
    const at = list.findIndex((one) => one.key.id === id)
    if (at !== -1) {
      list[at] = message
      if (touch) this.touch()
      return 'changed'
    }
    const time = atOf(message)
    let place = list.length
    for (;;) {
      const before = list[place - 1]
      if (!before || atOf(before) <= time) break
      place--
    }
    list.splice(place, 0, message)
    this.messages.set(jid, list)
    if (touch) this.touch()
    return 'new'
  }

  remove(jid: string, id: string): void {
    const list = this.messages.get(jid)
    if (!list) return
    const at = list.findIndex((one) => one.key.id === id)
    if (at === -1) return
    list.splice(at, 1)
    this.touch()
  }

  forgetChat(jid: string): void {
    this.messages.delete(jid)
    this.chats.delete(jid)
    this.touch()
  }

  touch(): void {
    this.dirty = true
    if (!this.name || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, WAIT)
  }

  private kept(): Record<string, string[]> {
    const lists = [...this.messages.entries()].map(([jid, list]) => ({
      jid,
      list: list.slice(-PER_CHAT),
      last: list.reduce((most, one) => Math.max(most, atOf(one)), 0),
    }))
    lists.sort((a, b) => b.last - a.last)
    const out: Record<string, string[]> = {}
    let room = MOST
    for (const { jid, list } of lists) {
      if (room <= 0) break
      const taken = list.slice(-room)
      room -= taken.length
      out[jid] = taken.map((one) => base64Of(this.kit.encode(one)))
    }
    return out
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
    const bytes = new TextEncoder().encode(
      packed({
        chats: [...this.chats.values()],
        contacts: [...this.contacts.values()],
        groups: [...this.groups.values()],
        messages: this.kept(),
      }),
    )
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
