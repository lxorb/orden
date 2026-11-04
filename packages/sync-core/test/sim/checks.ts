/** What must be true once a simulated run has gone quiet (docs/sync-v2.md section 12).
 *
 *  - Every device holds the tree and the texts the account holds, each row where
 *    somebody put it among the rest of its folder too (#1068).
 *  - The tree is whole: names unique per folder as folders compare them, every live
 *    entry in a live folder.
 *  - Every word ever typed is in a note or in a version, unless the person it was
 *    typed by (or somebody who could see it) took it out, or a crash took it before
 *    it was saved. Words are followed by marker tokens the simulator puts in
 *    everything it types, each one unique to the run.
 *  - No marker appears twice in one note: nothing was merged in twice.
 *  - Nothing exists on the account that no person made: no conflict copies, no notes
 *    the sync invented.
 *  - No folder is inside itself, however many moves crossed (#1068).
 *  - No marker is live in two notes at once: nothing was copied beside itself, bar the
 *    copy a person asked for by keeping both (#1068).
 *  - What a person restored is there, under the id it had, unless somebody deleted it
 *    again afterwards (#1068).
 *  - The modal was asked exactly when `diverge` says so.
 *
 *  Each failure is one sentence, so a failing seed says what went wrong. */

import { diverge } from '../../src/diverge'
import { nameKey } from '../../src/tree'
import type { AccountView, Classification, EntryView, View } from './adapters'

/** A marker: `mk`, digits, `z`. Self-delimiting, so a merge that glues two words
 *  together (two insertions at one point with no space between) cannot hide one. */
const MARKER = /mk\d+z/g

export function markersIn(text: string): string[] {
  return text.match(MARKER) ?? []
}

/** What the run knows about the words and the entries it caused. */
export interface Ledger {
  typed: Set<string>
  /** Taken out by a person who could see them: a cut, a paragraph, a note deleted. */
  retired: Set<string>
  /** Typed and never saved before a crash. */
  lost: Set<string>
  /** Every id a person made, or the run started with. */
  made: Set<string>
  /** Notes a person made by keeping both sides of a question: copies on purpose. */
  copies: Set<string>
  /** Each id a person restored, and the step it was restored at. */
  restored: Map<string, number>
  /** Each id a person deleted, and the last step it was deleted at. */
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

/** Whether two sides hold the same tree and the same texts. */
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
