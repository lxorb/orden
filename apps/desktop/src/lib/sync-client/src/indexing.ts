import { indexed, rehomed } from '@orden/scan/indexed'
import type { Query } from '@orden/scan/search/query'
import type { Found } from '@orden/scan/search/walk'
import type { IndexedNote } from '@orden/scan/wire'
import type { AwayFile, Engine } from './engine'
import type { Leaving } from './keeping'
import type { Reading } from './transport'
import type { IndexRow, IndexStore } from '../../web/index-store'

const BATCH = 200

const MOST_SKIPPED = 5000

const SCANNED = /\.(md|markdown|mdown|mkd|canvas|url|webloc)$/i

export interface Refreshed {
  root: string
  scans: IndexedNote[]
}

export class Indexing {
  private readonly rows = new Map<string, IndexRow>()
  private readonly loaded = new Set<string>()

  constructor(
    private readonly engine: Engine,
    private readonly reading: Reading,
    private readonly store: IndexStore,
  ) {}

  scans(): ReadonlyMap<string, IndexedNote> {
    return new Map([...this.rows].map(([id, row]) => [id, row.scan]))
  }

  async refresh(): Promise<Refreshed[]> {
    const out: Refreshed[] = []
    const away = this.engine.awayFiles()
    for (const space of this.engine.keepingFew()) {
      await this.load(space.id)
      const files = away.filter((one) => one.space === space.id && SCANNED.test(one.relative))
      const stale = files.filter((one) => (this.rows.get(one.id)?.docSeq ?? -1) < one.docSeq)
      const scans: IndexedNote[] = []
      for (let at = 0; at < stale.length; at += BATCH) {
        const batch = stale.slice(at, at + BATCH)
        const items = await this.reading.index(
          space.id,
          batch.map((one) => one.id),
        )
        if (items === 'missing') {
          await this.engine.keepWhole(space.id)
          break
        }
        if (items === null) break
        const byId = new Map(batch.map((one) => [one.id, one]))
        const kept: IndexRow[] = []
        const gone: string[] = []
        for (const item of items) {
          if ('refused' in item) {
            gone.push(item.id)
            continue
          }
          const file = byId.get(item.id)
          if (!item.scan || !file) continue
          const row = { id: item.id, space: space.id, docSeq: item.docSeq, scan: item.scan }
          kept.push(row)
          scans.push(rehomed(item.scan, file.relative))
        }
        await this.store.put(kept)
        await this.store.remove(gone)
        for (const row of kept) this.rows.set(row.id, row)
        for (const id of gone) this.rows.delete(id)
      }
      if (scans.length) out.push({ root: space.root, scans })
    }
    return out
  }

  async leaving(one: Leaving): Promise<void> {
    const stamp = { size: one.text.length, mtime: one.at, ctime: one.at }
    const scan = indexed(one.path, one.text, stamp)
    if (!scan) return
    const row = { id: one.id, space: one.space, docSeq: one.docSeq, scan }
    await this.store.put([row])
    this.rows.set(row.id, row)
  }

  readonly search = async (
    root: string,
    query: Query,
    terms: readonly string[],
    limit: number,
    onFound: (found: Found) => void,
    excluded: readonly string[],
  ): Promise<boolean> => {
    const space = this.engine.keepingFew().find((one) => samePath(one.root, root))
    if (!space) return true
    const away = new Map<string, AwayFile>(this.engine.awayFiles().map((one) => [one.id, one]))
    const kept = this.engine.keptIds(space.id)
    const here = new Set(kept)
    const skip = kept.slice(0, MOST_SKIPPED)
    const at = (id: string, path: string) => away.get(id)?.path ?? `${root}/${path}`
    let after: string | undefined
    let left = limit
    while (left > 0) {
      const page = await this.reading.search(space.id, {
        query,
        terms: [...terms],
        limit: left,
        ...(after === undefined ? {} : { after }),
        skip,
        excluded: [...excluded],
      })
      if (page === 'missing') {
        await this.engine.keepWhole(space.id)
        return false
      }
      if (page === null) return false
      const hits = page.hits.flatMap(({ id, ...hit }) =>
        here.has(id) ? [] : [{ ...hit, path: at(id, hit.path) }],
      )
      const loose = page.loose.flatMap(({ id, ...hit }) =>
        here.has(id) ? [] : [{ ...hit, path: at(id, hit.path) }],
      )
      left -= hits.length
      if (hits.length || loose.length) onFound({ hits, loose })
      if (page.after === null) return true
      after = page.after
    }
    return true
  }

  private async load(space: string) {
    if (this.loaded.has(space)) return
    this.loaded.add(space)
    for (const row of await this.store.of(space)) this.rows.set(row.id, row)
  }
}

function samePath(one: string, other: string): boolean {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm(one) === norm(other)
}
