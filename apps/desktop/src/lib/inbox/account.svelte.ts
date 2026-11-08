import { log } from '../log'
import { afterQuiet } from '../timing'
import { type ClosingDisk, openInboxDisk } from './disk'
import type { Item } from '@orden/bases/inbox-items'
import { InboxRecords, type InboxServer } from './store'

const SEND_AFTER = 1500

export interface Opening {
  owner: string | null
  server: InboxServer | null
  device: string
}

export class AccountInbox {
  changes = $state(0)
  answers = $state<boolean | null>(null)
  openedFor = $state<string | null | undefined>(undefined)

  private records: InboxRecords | null = null
  private disk: ClosingDisk | null = null
  private owner: string | null | undefined = undefined
  private server: InboxServer | null = null
  private device = 'device'
  private opening: Promise<void> = Promise.resolve()
  private exchanging: Promise<boolean> | null = null
  private again = false
  private channel: BroadcastChannel | null = null
  private readonly listeners: (() => void)[] = []
  private began: () => void = () => undefined
  private readonly started = new Promise<void>((begin) => {
    this.began = begin
  })

  private readonly sendSoon = afterQuiet(() => void this.exchange(), SEND_AFTER)

  constructor(
    private readonly open: (owner: string | null) => Promise<ClosingDisk> = openInboxDisk,
  ) {}

  opened(how: Opening): Promise<void> {
    this.server = how.server
    this.device = how.device
    this.began()
    if (how.owner === this.owner) {
      if (this.server) void this.opening.then(() => this.exchange())
      return this.opening
    }
    this.owner = how.owner
    this.opening = this.opening
      .then(() => this.switchTo(how.owner))
      .catch((error: unknown) => {
        log('warn', `inbox records did not open: ${String(error)}`)
      })
    return this.opening
  }

  private async switchTo(owner: string | null): Promise<void> {
    this.channel?.close()
    this.channel = null
    this.disk?.close()
    this.disk = null
    this.records = null
    this.answers = null
    this.openedFor = undefined
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(`orden-inbox:${owner ?? ''}`)
    const early = { heard: false }
    let loaded: InboxRecords | null = null
    if (channel) {
      channel.onmessage = () => {
        if (loaded) void loaded.load()
        else early.heard = true
      }
    }
    const disk = await this.open(owner)
    const records = new InboxRecords(disk, this.device)
    await records.load()
    const carried = owner !== null && (await this.carry(records))
    if (this.owner !== owner) {
      channel?.close()
      disk.close()
      return
    }
    this.disk = disk
    this.records = records
    this.channel = channel
    records.hear(() => this.told())
    loaded = records
    if (early.heard) void records.load()
    if (carried) channel?.postMessage('changed')
    this.openedFor = owner
    this.told()
    if (this.server) void this.exchange()
  }

  private async carry(into: InboxRecords): Promise<boolean> {
    const local = await this.open(null)
    try {
      const items = await local.items()
      if (!items.length) return false
      await into.adopt(items)
      await local.clear()
      return true
    } finally {
      local.close()
    }
  }

  private told(): void {
    this.changes += 1
    for (const listener of [...this.listeners]) listener()
  }

  hear(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const at = this.listeners.indexOf(listener)
      if (at !== -1) this.listeners.splice(at, 1)
    }
  }

  private async ready(): Promise<InboxRecords> {
    await this.started
    for (;;) {
      const waiting = this.opening
      await waiting
      if (this.records && waiting === this.opening) return this.records
      if (waiting === this.opening) throw new Error('the inbox did not open')
    }
  }

  async text(): Promise<string> {
    return (await this.ready()).text()
  }

  private wrote(): void {
    this.channel?.postMessage('changed')
    if (this.server) this.sendSoon()
  }

  async write(markdown: string, over?: string): Promise<void> {
    await (await this.ready()).write(markdown, over)
    this.wrote()
  }

  async carried(items: readonly Item[]): Promise<void> {
    await (await this.ready()).carry(items)
    this.wrote()
  }

  async headed(text: string): Promise<void> {
    await (await this.ready()).headed(text)
    this.wrote()
  }

  async kept(ids: readonly string[]): Promise<boolean> {
    const records = await this.ready()
    if (!ids.every((id) => records.has(id))) return false
    if (this.owner === null) return true
    if (!this.server || !(await this.exchange())) return false
    return records.sent(ids)
  }

  exchange(): Promise<boolean> {
    if (this.exchanging) {
      this.again = true
      return this.exchanging
    }
    this.exchanging = this.exchanged().finally(() => {
      this.exchanging = null
      if (this.again) {
        this.again = false
        void this.exchange()
      }
    })
    return this.exchanging
  }

  private async exchanged(): Promise<boolean> {
    const server = this.server
    const records = this.records
    if (!server || !records || this.openedFor !== this.owner) return false
    try {
      const before = this.changes
      const answered = await records.exchange(server)
      if (records === this.records) {
        this.answers = answered
        if (this.changes !== before) this.channel?.postMessage('changed')
      }
      return answered
    } catch (error) {
      log('warn', `inbox did not reach the account: ${String(error)}`)
      return false
    }
  }
}

export const accountInbox = new AccountInbox()
