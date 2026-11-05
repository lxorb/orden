/** The files of a space this browser keeps no words of (#1126; sync2/keeping.ts): listed,
 *  found and moved like any other, and fetched when something reads them.
 *
 *  The engine says which they are, by the path the file list shows each at, whenever its
 *  tree moves (`keepAway`); nothing here asks it. The browser's commands read this
 *  beside their own rows: the listing and every "is anything there" count these files
 *  as there, a read of one fetches it first (`bringBack`), and a move or a delete of
 *  one is the engine's operation alone, with no row to move. A command the engine
 *  itself sends says `raw`, and is answered from the rows as they are. */

import type { Query } from '@orden/scan/search/query'
import type { Found } from '@orden/scan/search/walk'
import type { IndexedNote } from '@orden/scan/wire'
import { SvelteSet } from 'svelte/reactivity'
import { normalise, within } from './paths'

/** One file kept away, as the listing draws it, by its entry's id. */
interface Away {
  id: string
  path: string
  size: number
  modified: number
}

/** A search of what is kept away under a root, as the account answers it: hits handed
 *  over as they come, in the shape the walk here hands them (search/space.ts). */
type SearchAway = (
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[],
) => Promise<void>

/** What a read that found a file away, and could not fetch it, is answered: the
 *  device is offline, or the account would not say. */
export const NOT_HERE = 'that note is not on this device, and the account could not be reached'

class KeptAway {
  /** By path. Replaced whole on every change, so whatever draws one is drawn again. */
  private files = $state.raw(new Map<string, Away>())
  private fetch: ((path: string) => Promise<boolean>) | null = null
  /** What the account said of each, by id: its scan (web/index-store.ts). */
  private scans: ReadonlyMap<string, IndexedNote> = new Map()
  private searching: SearchAway | null = null
  /** The files being fetched this moment, by path: the file list's cloud pulses. */
  readonly fetching = new SvelteSet<string>()
  /** Whether the account could not be reached at the last try: what a note that is
   *  away says when it is opened. */
  offline = $state(false)

  /** The files kept away now, and how one is fetched. Answers the paths that are no
   *  longer away. */
  keep(files: readonly Away[], fetch: (path: string) => Promise<boolean>): string[] {
    const next = new Map(files.map((one) => [normalise(one.path), one]))
    const back = [...this.files.keys()].filter((path) => !next.has(path))
    this.files = next
    this.fetch = fetch
    return back
  }

  /** None, signed out or kept whole. */
  clear() {
    this.scans = new Map()
    this.searching = null
    if (!this.files.size && !this.fetch) return
    this.files = new Map()
    this.fetch = null
  }

  /** What the account said of each file kept away, and how the rest of a space is
   *  searched. */
  answeredBy(scans: ReadonlyMap<string, IndexedNote>, search: SearchAway) {
    this.scans = scans
    this.searching = search
  }

  /** The scan of a file kept away, by its id, where the account has said it. */
  scanOf(id: string): IndexedNote | null {
    return this.scans.get(id) ?? null
  }

  /** What is kept away under `root`, searched by the account; nothing where nothing is,
   *  or nobody answers for it. */
  async search(
    root: string,
    query: Query,
    terms: readonly string[],
    limit: number,
    onFound: (found: Found) => void,
    excluded: readonly string[] = [],
  ): Promise<void> {
    if (!this.searching || !this.under(root).length || limit <= 0) return
    await this.searching(root, query, terms, limit, onFound, excluded)
  }

  at(path: string): Away | null {
    return this.files.get(normalise(path)) ?? null
  }

  /** Every file kept away at `path` or under it. */
  under(path: string): Away[] {
    const base = normalise(path)
    const exact = this.files.get(base)
    if (exact) return [exact]
    return [...this.files.entries()].flatMap(([one, away]) =>
      one !== base && within(base, one) ? [away] : [],
    )
  }

  /** Every file kept away. */
  all(): Away[] {
    return [...this.files.values()]
  }

  /** A file about to be opened - its row under the pointer - fetched ahead, quietly. */
  ahead(path: string) {
    if (!this.at(path) || this.fetching.has(normalise(path))) return
    void this.bringBack(path)
  }

  /** The file at `path` fetched, where it is away. Answers whether its words are here
   *  now. */
  async bringBack(path: string): Promise<boolean> {
    const at = normalise(path)
    if (!this.files.has(at) || !this.fetch) return false
    this.fetching.add(at)
    try {
      const here = await this.fetch(at)
      this.offline = !here
      if (here) this.files = new Map([...this.files].filter(([one]) => one !== at))
      return here
    } catch {
      this.offline = true
      return false
    } finally {
      this.fetching.delete(at)
    }
  }
}

export const keptAway = new KeptAway()
