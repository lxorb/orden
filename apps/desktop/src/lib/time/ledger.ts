import type { TimeChange, TimeEntry } from '@orden/sync-core/time'

export interface Row {
  kind: string
  id: string
  value: Record<string, unknown> | null
  dirty: number
  at: number
}

const keyOf = (kind: string, id: string) => `${kind}\u0000${id}`

export class Ledger {
  private readonly rows = new Map<string, Row>()
  private revision = 0

  constructor(rows: readonly Row[] = []) {
    for (const row of rows) {
      this.rows.set(keyOf(row.kind, row.id), row)
      this.revision = Math.max(this.revision, row.dirty)
    }
  }

  get(kind: string, id: string): Row | undefined {
    return this.rows.get(keyOf(kind, id))
  }

  live(kind: string): Row[] {
    return [...this.rows.values()].filter((row) => row.kind === kind && row.value !== null)
  }

  write(kind: string, id: string, value: Record<string, unknown> | null, at: number): Row {
    this.revision += 1
    const row: Row = { kind, id, value, dirty: this.revision, at }
    this.rows.set(keyOf(kind, id), row)
    return row
  }

  pending(most: number): Row[] {
    return [...this.rows.values()].filter((row) => row.dirty > 0).slice(0, most)
  }

  sent(rows: readonly Row[]): Row[] {
    const out: Row[] = []
    for (const row of rows) {
      const now = this.get(row.kind, row.id)
      if (now?.dirty !== row.dirty) continue
      const clean = { ...now, dirty: 0 }
      this.rows.set(keyOf(row.kind, row.id), clean)
      out.push(clean)
    }
    return out
  }

  pulled(entries: readonly TimeEntry[]): Row[] {
    const out: Row[] = []
    for (const entry of entries) {
      if ((this.get(entry.kind, entry.id)?.dirty ?? 0) > 0) continue
      const row: Row = {
        kind: entry.kind,
        id: entry.id,
        value: entry.value,
        dirty: 0,
        at: entry.at,
      }
      this.rows.set(keyOf(entry.kind, entry.id), row)
      out.push(row)
    }
    return out
  }
}

export const changeOf = (row: Row): TimeChange => ({ kind: row.kind, id: row.id, value: row.value })
