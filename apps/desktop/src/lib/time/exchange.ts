import { MOST_TIME_CHANGES, type TimeChange, type TimePage } from '@orden/sync-core/time'
import { changeOf, type Ledger, type Row } from './ledger'

export interface TimeServer {
  pull(since: number): Promise<TimePage | null>
  push(changes: readonly TimeChange[]): Promise<boolean>
}

export interface Exchanged {
  cursor: number
  written: Row[]
  reached: boolean
}

const MOST_PAGES = 50

export async function exchange(
  ledger: Ledger,
  server: TimeServer,
  since: number,
): Promise<Exchanged> {
  const written: Row[] = []
  for (;;) {
    const sending = ledger.pending(MOST_TIME_CHANGES)
    if (!sending.length) break
    if (!(await server.push(sending.map(changeOf))))
      return { cursor: since, written, reached: false }
    written.push(...ledger.sent(sending))
  }

  let cursor = since
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const got = await server.pull(cursor)
    if (!got) return { cursor, written, reached: false }
    written.push(...ledger.pulled(got.entries))
    cursor = Math.max(cursor, got.cursor)
    if (!got.more) break
  }
  return { cursor, written, reached: true }
}
