import type { Query } from '@orden/scan/search/query'
import type { Found } from '@orden/scan/search/walk'
import type { IndexedNote } from '@orden/scan/wire'
import { SvelteSet } from 'svelte/reactivity'
import { normalise, within } from './paths'

interface Away {
  id: string
  path: string
  size: number
  modified: number
}

type SearchAway = (
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[],
) => Promise<boolean>

export const NOT_HERE = 'that note is not on this device, and the account could not be reached'

class KeptAway {
  private files = $state.raw(new Map<string, Away>())
  private fetch: ((path: string) => Promise<boolean>) | null = null
  private scans: ReadonlyMap<string, IndexedNote> = new Map()
  private searching: SearchAway | null = null
  readonly fetching = new SvelteSet<string>()
  offline = $state(false)

  keep(files: readonly Away[], fetch: (path: string) => Promise<boolean>): string[] {
    const next = new Map(files.map((one) => [normalise(one.path), one]))
    const back = [...this.files.keys()].filter((path) => !next.has(path))
    this.files = next
    this.fetch = fetch
    return back
  }

  clear() {
    this.scans = new Map()
    this.searching = null
    if (!this.files.size && !this.fetch) return
    this.files = new Map()
    this.fetch = null
  }

  answeredBy(scans: ReadonlyMap<string, IndexedNote>, search: SearchAway) {
    this.scans = scans
    this.searching = search
  }

  scanOf(id: string): IndexedNote | null {
    return this.scans.get(id) ?? null
  }

  async search(
    root: string,
    query: Query,
    terms: readonly string[],
    limit: number,
    onFound: (found: Found) => void,
    excluded: readonly string[] = [],
  ): Promise<boolean> {
    if (!this.under(root).length || limit <= 0) return true
    if (!this.searching) return false
    return await this.searching(root, query, terms, limit, onFound, excluded)
  }

  went(path: string) {
    const at = normalise(path)
    if (this.files.has(at)) return
    this.files = new Map([...this.files, [at, { id: '', path, size: 0, modified: 0 }]])
  }

  at(path: string): Away | null {
    return this.files.get(normalise(path)) ?? null
  }

  under(path: string): Away[] {
    const base = normalise(path)
    const exact = this.files.get(base)
    if (exact) return [exact]
    return [...this.files.entries()].flatMap(([one, away]) =>
      one !== base && within(base, one) ? [away] : [],
    )
  }

  all(): Away[] {
    return [...this.files.values()]
  }

  ahead(path: string) {
    if (!this.at(path) || this.fetching.has(normalise(path))) return
    void this.bringBack(path)
  }

  async bringBackUnder(path: string): Promise<boolean> {
    const base = normalise(path)
    const paths = this.under(base).map((one) => normalise(one.path))
    if (!paths.length) return true
    if (!this.fetch) return false
    for (const one of paths) this.fetching.add(one)
    try {
      const here = await this.fetch(base)
      this.offline = !here
      const brought = new Set(paths)
      if (here) this.files = new Map([...this.files].filter(([one]) => !brought.has(one)))
      return here
    } catch {
      this.offline = true
      return false
    } finally {
      for (const one of paths) this.fetching.delete(one)
    }
  }

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
