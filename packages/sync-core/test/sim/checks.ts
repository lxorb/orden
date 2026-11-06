import { diverge } from '../../src/diverge'
import { nameKey } from '../../src/tree'
import type { AccountView, Classification, EntryView, View } from './adapters'

const MARKER = /mk\d+z/g

export function markersIn(text: string): string[] {
  return text.match(MARKER) ?? []
}

export interface Ledger {
  typed: Set<string>
  retired: Set<string>
  lost: Set<string>
  made: Set<string>
  copies: Set<string>
  restored: Map<string, number>
  deleted: Map<string, number>
}

export function ledger(initial: Iterable<string>): Ledger {
  return {
    typed: new Set(),
    retired: new Set(),
    lost: new Set(),
    made: new Set(initial),
    copies: new Set(),
    restored: new Map(),
    deleted: new Map(),
  }
}

function sortedEntries(entries: readonly EntryView[]): string {
  return JSON.stringify(
    [...entries]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((entry) => [entry.id, entry.kind, entry.parent, entry.name, entry.pos ?? null]),
  )
}

function sortedTexts(texts: Record<string, string>): string {
  return JSON.stringify(Object.entries(texts).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function sameView(one: View, other: View): boolean {
  return (
    sortedEntries(one.entries) === sortedEntries(other.entries) &&
    sortedTexts(one.texts) === sortedTexts(other.texts)
  )
}

export function judge(
  book: Ledger,
  account: AccountView,
  devices: readonly (View & { id: string })[],
  classifications: readonly Classification[],
): string[] {
  const failures: string[] = []

  for (const device of devices) {
    if (sortedEntries(device.entries) !== sortedEntries(account.entries)) {
      failures.push(`${device.id} holds another tree than the account`)
    }
    for (const [id, text] of Object.entries(account.texts)) {
      if ((device.texts[id] ?? '') !== text) failures.push(`${device.id} reads ${id} differently`)
    }
  }

  const live = new Map(account.entries.map((entry) => [entry.id, entry]))
  const names = new Set<string>()
  for (const entry of account.entries) {
    const key = `${entry.parent ?? ''}/${nameKey(entry.name)}`
    if (names.has(key)) failures.push(`two entries answer to ${key}`)
    names.add(key)
    if (entry.parent !== null && live.get(entry.parent)?.kind !== 'folder') {
      failures.push(`${entry.id} is in ${entry.parent}, which is not a live folder`)
    }
    if (!book.made.has(entry.id)) failures.push(`${entry.id} (${entry.name}) was made by nobody`)
  }

  for (const entry of account.entries) {
    const above = new Set<string>([entry.id])
    for (let at = entry.parent; at !== null; at = live.get(at)?.parent ?? null) {
      if (above.has(at)) {
        failures.push(`${entry.id} is inside itself`)
        break
      }
      above.add(at)
    }
  }

  const holder = new Map<string, string>()
  for (const [id, text] of Object.entries(account.texts)) {
    if (!live.has(id) || book.copies.has(id)) continue
    for (const marker of new Set(markersIn(text))) {
      const other = holder.get(marker)
      if (other !== undefined && other !== id) {
        failures.push(`${marker} is in ${other} and in ${id}`)
      }
      holder.set(marker, id)
    }
  }

  for (const [id, at] of book.restored) {
    const again = book.deleted.get(id)
    if (!live.has(id) && (again === undefined || again < at)) {
      failures.push(`${id} was restored and is not there`)
    }
  }

  const everywhere = [...Object.values(account.texts), ...account.versions].join('\n')
  const kept = new Set(markersIn(everywhere))
  for (const marker of book.typed) {
    if (book.retired.has(marker) || book.lost.has(marker) || kept.has(marker)) continue
    failures.push(`${marker} was typed and is in no note and no version`)
  }

  for (const [id, text] of Object.entries(account.texts)) {
    const seen = new Set<string>()
    for (const marker of markersIn(text)) {
      if (seen.has(marker)) failures.push(`${marker} is in ${id} twice`)
      seen.add(marker)
    }
  }

  for (const one of classifications) {
    const verdict = diverge(one.base, one.local, one.remote, one.times, one.merged).verdict
    if ((verdict === 'diverged') !== one.held) {
      failures.push(
        `${one.id}: diverge says ${verdict} and the device ${one.held ? 'held' : 'did not hold'} it`,
      )
    }
  }

  return failures
}
