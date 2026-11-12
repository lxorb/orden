import { TIME_PAGE, timeChangesOf, type TimeChange, type TimeEntry } from '@orden/sync-core'
import type { TimeServer } from './exchange'

export class FakeTimeServer implements TimeServer {
  readonly entries = new Map<string, TimeEntry>()
  pushes = 0
  private next = 1

  pull(since: number) {
    const page = [...this.entries.values()]
      .filter((one) => one.seq > since)
      .sort((one, other) => one.seq - other.seq)
    const shown = page.slice(0, TIME_PAGE)
    return Promise.resolve({
      entries: shown.map((one) => ({ ...one })),
      cursor: shown.at(-1)?.seq ?? since,
      more: page.length > TIME_PAGE,
    })
  }

  push(changes: readonly TimeChange[]) {
    this.pushes += 1
    if (!timeChangesOf({ changes })) return Promise.reject(new Error('400: not a time change'))
    for (const change of changes) {
      this.entries.set(`${change.kind}:${change.id}`, { ...change, seq: this.next, at: this.next })
      this.next += 1
    }
    return Promise.resolve(true)
  }
}

export const OLD_SERVER: TimeServer = {
  pull: () => Promise.resolve(null),
  push: () => Promise.resolve(false),
}
