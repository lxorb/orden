import { todayOf } from '@orden/bases'
import {
  inboxStamp,
  mergedInbox,
  MOST_INBOX_CHANGES,
  newer,
  type InboxChange,
  type InboxFields,
  type InboxHeld,
  type InboxPage,
  type InboxStamps,
} from '@orden/sync-core/inbox'
import { changesTo, HEAD, type Item, rendered } from './items'

export interface InboxServer {
  pull(since: number): Promise<InboxPage | null>
  push(changes: readonly InboxChange[]): Promise<boolean>
}

export interface Kept extends InboxHeld {
  id: string
  dirty: string[]
}

export interface InboxDisk {
  items(): Promise<Kept[]>
  put(items: readonly Kept[]): Promise<Kept[]>
  cursor(): Promise<number>
  keepCursor(cursor: number): Promise<void>
}

export function keptOver(was: Kept | undefined, item: Kept): Kept {
  if (!was) return item
  const merged = mergedInbox(was, item)
  const theirs = was.dirty.filter((key) => newer(was.stamps[key], item.stamps[key]))
  return {
    id: item.id,
    fields: merged.fields,
    stamps: merged.stamps,
    dirty: [...new Set([...item.dirty, ...theirs])],
  }
}

const MOST_PAGES = 50

const CARRIED_STAMP = inboxStamp(0, 0, 'carried')

const DONE = new Set(['x', 'X'])

export class InboxRecords {
  private held = new Map<string, Kept>()
  private seen = new Set<string>()
  private last = 0
  private count = 0
  private cursor = 0
  private listeners = new Set<() => void>()

  constructor(
    private readonly disk: InboxDisk,
    private readonly device: string,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () =>
      `i${crypto.randomUUID().replace(/-/g, '').slice(0, 15)}`,
  ) {}

  async load(): Promise<void> {
    const held = new Map<string, Kept>()
    for (const one of await this.disk.items()) held.set(one.id, one)
    const changed =
      held.size !== this.held.size ||
      [...held].some(([id, one]) => JSON.stringify(one) !== JSON.stringify(this.held.get(id)))
    this.held = held
    this.cursor = Math.max(this.cursor, await this.disk.cursor())
    if (changed) this.told()
  }

  hear(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private told(): void {
    for (const listener of this.listeners) listener()
  }

  items(): Item[] {
    return [...this.held.values()].map(({ id, fields }) => ({ id, fields }))
  }

  text(): string {
    const items = this.items()
    for (const one of items) this.seen.add(one.id)
    return rendered(items)
  }

  get pending(): number {
    let many = 0
    for (const one of this.held.values()) if (one.dirty.length) many += 1
    return many
  }

  has(id: string): boolean {
    return this.held.has(id)
  }

  sent(ids: Iterable<string>): boolean {
    for (const id of ids) {
      const one = this.held.get(id)
      if (!one || one.dirty.length) return false
    }
    return true
  }

  private stamp(): string {
    const at = this.now()
    if (at > this.last) {
      this.last = at
      this.count = 0
    } else this.count += 1
    return inboxStamp(this.last, this.count, this.device)
  }

  private async kept(touched: readonly Kept[]): Promise<void> {
    if (!touched.length) return
    for (const one of await this.disk.put(touched)) this.held.set(one.id, one)
  }

  async change(changes: readonly { id: string; fields: InboxFields }[]): Promise<void> {
    if (!changes.length) return
    const touched: Kept[] = []
    for (const change of changes) {
      const stamp = this.stamp()
      const stamps: InboxStamps = Object.fromEntries(
        Object.keys(change.fields).map((key) => [key, stamp]),
      )
      const was = this.held.get(change.id)
      const merged = mergedInbox(was ?? null, { fields: change.fields, stamps })
      const dirty = [...new Set([...(was?.dirty ?? []), ...Object.keys(change.fields)])]
      const kept: Kept = { id: change.id, fields: merged.fields, stamps: merged.stamps, dirty }
      this.held.set(change.id, kept)
      this.seen.add(change.id)
      touched.push(kept)
    }
    await this.kept(touched)
    this.told()
  }

  async carry(items: readonly Item[]): Promise<void> {
    const touched: Kept[] = []
    for (const item of items) {
      if (this.held.has(item.id)) continue
      const keys = Object.keys(item.fields)
      const kept: Kept = {
        id: item.id,
        fields: { ...item.fields },
        stamps: Object.fromEntries(keys.map((key) => [key, CARRIED_STAMP])),
        dirty: keys,
      }
      this.held.set(item.id, kept)
      touched.push(kept)
    }
    if (!touched.length) return
    await this.kept(touched)
    this.told()
  }

  async adopt(items: readonly Kept[]): Promise<void> {
    if (!items.length) return
    await this.kept(items.map((one) => ({ ...one, dirty: Object.keys(one.fields) })))
    this.told()
  }

  async headed(text: string): Promise<void> {
    const said = text.trim()
    const was = this.held.get(HEAD)?.fields
    const head = was?.gone !== true && typeof was?.text === 'string' ? was.text : ''
    if (said === '' || head.includes(said)) return
    await this.change([
      { id: HEAD, fields: { text: head ? `${head}\n\n${said}` : said, gone: false } },
    ])
  }

  private dated(changes: { id: string; fields: InboxFields }[]): typeof changes {
    const today = todayOf(new Date(this.now()))
    return changes.map((change) => {
      const was = this.held.get(change.id)?.fields ?? {}
      const status = change.fields.status ?? was.status
      const fields = { ...change.fields }
      const has = (key: string) => (key in fields ? fields[key] : was[key])
      if (typeof status === 'string' && DONE.has(status) && !has('completed')) {
        fields.completed = today
      }
      if (status === '-' && !has('cancelledOn')) fields.cancelledOn = today
      if (status === ' ' && 'status' in change.fields) {
        if (was.completed && !('completed' in change.fields)) fields.completed = null
        if (was.cancelledOn && !('cancelledOn' in change.fields)) fields.cancelledOn = null
      }
      return { id: change.id, fields }
    })
  }

  async write(markdown: string): Promise<void> {
    const changes = changesTo(this.items(), markdown, this.newId, (id) => this.seen.has(id))
    await this.change(this.dated(changes))
  }

  private sending(): InboxChange[] {
    const out: InboxChange[] = []
    for (const one of this.held.values()) {
      if (!one.dirty.length) continue
      const fields: InboxFields = {}
      const stamps: InboxStamps = {}
      for (const key of one.dirty) {
        fields[key] = one.fields[key] ?? null
        stamps[key] = one.stamps[key] ?? this.stamp()
      }
      out.push({ id: one.id, fields, stamps })
      if (out.length >= MOST_INBOX_CHANGES) break
    }
    return out
  }

  async exchange(server: InboxServer): Promise<boolean> {
    for (;;) {
      const sending = this.sending()
      if (!sending.length) break
      if (!(await server.push(sending))) return false
      const cleared: Kept[] = []
      for (const sent of sending) {
        const now = this.held.get(sent.id)
        if (!now) continue
        const dirty = now.dirty.filter((key) => now.stamps[key] !== sent.stamps[key])
        const kept = { ...now, dirty }
        this.held.set(sent.id, kept)
        cleared.push(kept)
      }
      await this.kept(cleared)
    }

    let changed = false
    for (let page = 0; page < MOST_PAGES; page += 1) {
      const got = await server.pull(this.cursor)
      if (!got) return false
      const touched: Kept[] = []
      for (const item of got.items) {
        const was = this.held.get(item.id)
        const merged = mergedInbox(was ?? null, item)
        if (!merged.changed) continue
        const kept: Kept = {
          id: item.id,
          fields: merged.fields,
          stamps: merged.stamps,
          dirty: (was?.dirty ?? []).filter((key) => merged.stamps[key] === was?.stamps[key]),
        }
        this.held.set(item.id, kept)
        touched.push(kept)
      }
      await this.kept(touched)
      changed ||= touched.length > 0
      this.cursor = Math.max(this.cursor, got.cursor)
      await this.disk.keepCursor(this.cursor)
      if (!got.more) break
    }
    if (changed) this.told()
    return true
  }
}
