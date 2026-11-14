import {
  inboxChangeOf,
  inboxStamp,
  mergedInbox,
  MOST_INBOX_CHANGES,
  newer,
  type InboxChange,
  type InboxFields,
  type InboxHeld,
  type InboxPage,
  type InboxStamps,
} from '@orden/sync-core'

export interface TodoServer {
  pull(since: number): Promise<InboxPage | null>
  push(changes: readonly InboxChange[]): Promise<boolean>
}

export interface Kept extends InboxHeld {
  id: string
  dirty: string[]
}

export interface TodoDisk {
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

export class TodoRecords {
  private held = new Map<string, Kept>()
  private last = 0
  private count = 0
  private cursor = 0
  private listeners = new Set<() => void>()

  constructor(
    private readonly disk: TodoDisk,
    private readonly device: string,
    private readonly now: () => number = Date.now,
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

  entries(): readonly { id: string; fields: InboxFields }[] {
    return [...this.held.values()].map(({ id, fields }) => ({ id, fields }))
  }

  fieldsOf(id: string): InboxFields | null {
    return this.held.get(id)?.fields ?? null
  }

  get pending(): number {
    let many = 0
    for (const one of this.held.values()) if (one.dirty.length) many += 1
    return many
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
      touched.push(kept)
    }
    await this.kept(touched)
    this.told()
  }

  async adopt(items: readonly Kept[]): Promise<void> {
    if (!items.length) return
    await this.kept(items.map((one) => ({ ...one, dirty: Object.keys(one.fields) })))
    this.told()
  }

  private sending(): InboxChange[] {
    const out: InboxChange[] = []
    for (let one of [...this.held.values()]) {
      if (!one.dirty.length) continue
      const missing = one.dirty.filter((key) => one.stamps[key] === undefined)
      if (missing.length) {
        const stamp = this.stamp()
        const stamped: Kept = {
          ...one,
          stamps: { ...one.stamps, ...Object.fromEntries(missing.map((key) => [key, stamp])) },
        }
        this.held.set(one.id, stamped)
        one = stamped
      }
      const fields: InboxFields = {}
      const stamps: InboxStamps = {}
      for (const key of one.dirty) {
        fields[key] = one.fields[key] ?? null
        const stamp = one.stamps[key]
        if (stamp !== undefined) stamps[key] = stamp
      }
      const change = inboxChangeOf({ id: one.id, fields, stamps })
      if (!change) continue
      out.push(change)
      if (out.length >= MOST_INBOX_CHANGES) break
    }
    return out
  }

  async exchange(server: TodoServer): Promise<boolean> {
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

export class MemoryTodoDisk implements TodoDisk {
  private held = new Map<string, Kept>()
  private at = 0
  open = true

  items(): Promise<Kept[]> {
    return Promise.resolve([...this.held.values()].map((one) => structuredClone(one)))
  }

  put(items: readonly Kept[]): Promise<Kept[]> {
    const out: Kept[] = []
    for (const item of items) {
      const kept = keptOver(this.held.get(item.id), structuredClone(item))
      this.held.set(item.id, kept)
      out.push(kept)
    }
    return Promise.resolve(out)
  }

  cursor(): Promise<number> {
    return Promise.resolve(this.at)
  }

  keepCursor(cursor: number): Promise<void> {
    this.at = cursor
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.held.clear()
    this.at = 0
    return Promise.resolve()
  }

  close(): void {
    this.open = false
  }
}

interface Row {
  fields: InboxFields
  stamps: InboxStamps
  seq: number
}

export class MemoryTodoServer {
  private users = new Map<string, { rows: Map<string, Row>; next: number }>()
  down = false

  private of(user: string) {
    const held = this.users.get(user) ?? { rows: new Map<string, Row>(), next: 1 }
    this.users.set(user, held)
    return held
  }

  forUser(user: string): TodoServer {
    return {
      pull: (since) => {
        if (this.down) return Promise.resolve(null)
        const held = this.of(user)
        const items = [...held.rows]
          .filter(([, row]) => row.seq > since)
          .sort((a, b) => a[1].seq - b[1].seq)
          .map(([id, row]) => ({ id, fields: row.fields, stamps: row.stamps, seq: row.seq, at: 0 }))
        return Promise.resolve({ items, cursor: held.next - 1, more: false })
      },
      push: (changes) => {
        if (this.down) return Promise.resolve(false)
        const held = this.of(user)
        for (const change of changes) {
          const was = held.rows.get(change.id) ?? null
          const merged = mergedInbox(was, change)
          held.rows.set(change.id, { fields: merged.fields, stamps: merged.stamps, seq: held.next })
          held.next += 1
        }
        return Promise.resolve(true)
      },
    }
  }
}
