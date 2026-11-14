import { visitKey } from '../web-tab/src/visits'
import { namesAgents, type NoteToMake, noteToMake } from './new-note'
import type { Row } from './rows'

export function makeable(term: string, taken: ReadonlySet<string>): NoteToMake | null {
  const made = noteToMake(term)
  if (!made) return null

  const at = made.folder ? `${made.folder}/${made.name}` : made.name
  return taken.has(at.toLowerCase()) ? null : made
}

export { typedAddress } from '@orden/scan/typed'

export function withOffers(
  found: readonly Row[],
  term: string,
  address: { url: string; shown: string } | null,
  make: NoteToMake | null,
): Row[] {
  const there = address && visitKey(address.url)
  const goes = found.some(
    (row) =>
      (row.kind === 'page' && row.url === there) ||
      (row.kind === 'tab' && row.tab.url !== null && row.tab.url === there),
  )

  const offers: Row[] =
    address && !goes ? [{ kind: 'address', url: address.url, address: address.shown }] : []
  const written = /^(https?:\/\/|www\.)/i.test(term.trim())
  const out = written ? [...offers, ...found] : [...found, ...offers]

  if (namesAgents(term)) return [...out, { kind: 'agents' }]
  return make ? [...out, { kind: 'make', make }] : out
}
