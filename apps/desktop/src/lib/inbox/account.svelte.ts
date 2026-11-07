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
  private changedAt = 0
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
    const disk = await this.open(owner)
    const records = new InboxRecords(disk, this.device)
    await records.load()
    if (owner !== null) await this.carry(records)
    if (this.owner !== owner) {
      disk.close()
      return
    }
    this.disk = disk
    this.records = records
    records.hear(() => this.told())
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`orden-inbox:${owner ?? ''}`)
      this.channel.onmessage = () => void records.load()
    }
    this.openedFor = owner
    this.told()
    if (this.server) void this.exchange()
  }

  private async carry(into: InboxRecords): Promise<void> {
    const local = await this.open(null)
    try {
      const items = await local.items()
      if (!items.length) return
      await into.adopt(items)
      await local.clear()
    } finally {
      local.close()
    }
  }

  private told(): void {
    this.changedAt = Date.now()
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

  async stamp(): Promise<{ modified: number; len: number }> {
    const text = await this.text()
    return { modified: this.changedAt, len: text.length }
  }

  private wrote(): void {
    this.channel?.postMessage('changed')
    if (this.server) this.sendSoon()
  }

  async write(markdown: string): Promise<void> {
    await (await this.ready()).write(markdown)
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
    if (!server || !records) return false
    try {
      const answered = await records.exchange(server)
      if (records === this.records) this.answers = answered
      return answered
    } catch (error) {
      log('warn', `inbox did not reach the account: ${String(error)}`)
      return false
    }
  }
}

export const accountInbox = new AccountInbox()
