import {
  insideItsSpace,
  relativeTo,
  within,
  isNumber,
  isRecord,
  keepJson,
  filledIn,
  type Folded,
  readSpaces,
  without,
} from '../platform/src/api'
import { carried, moving } from './file-ops'

export const STORAGE_KEY = 'orden:archived'

export type ArchiveMap = Record<string, number>

export const MOST_ARCHIVED = 1000

export function archiveMap(value: unknown): ArchiveMap {
  if (!isRecord(value)) return {}

  const kept: [string, number][] = []
  for (const [path, when] of Object.entries(value)) {
    if (kept.length >= MOST_ARCHIVED) break
    if (insideItsSpace(path) && isNumber(when) && Number.isSafeInteger(when) && when !== 0) {
      kept.push([path, when])
    }
  }

  return Object.fromEntries(kept)
}

export function coveredBy(keys: ReadonlySet<string>, at: string): string | null {
  if (!keys.size) return null

  for (let path = at; ;) {
    if (keys.has(path)) return path
    const cut = path.lastIndexOf('/')
    if (cut === -1) return null
    path = path.slice(0, cut)
  }
}

function under(path: string, key: string, root: string): boolean {
  return !!key && within(key, path, root) !== null
}

interface Kept extends Folded {
  map: ArchiveMap
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({ map: archiveMap(one.map) }))
}

const EMPTY: ArchiveMap = {}

export class Archive {
  private spaces = $state.raw<Record<string, Kept>>(read())
  private live = new WeakMap<ArchiveMap, ReadonlySet<string>>()
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}

  constructor(private readonly root: () => string | null) {}

  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): ArchiveMap {
    return this.spaces[root]?.map ?? EMPTY
  }

  account(root: string): string | null {
    return this.spaces[root]?.account ?? null
  }

  keysOf(root: string): ReadonlySet<string> {
    const map = this.of(root)
    let keys = this.live.get(map)
    if (!keys) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one map's snapshot, replaced with the map
      keys = new Set(Object.keys(map).filter((path) => (map[path] ?? 0) > 0))
      this.live.set(map, keys)
    }

    return keys
  }

  get any(): boolean {
    const root = this.root()
    return root !== null && this.keysOf(root).size > 0
  }

  coverIn(root: string, path: string): string | null {
    return coveredBy(this.keysOf(root), relativeTo(root, path))
  }

  has(path: string): boolean {
    const root = this.root()
    return root !== null && this.coverIn(root, path) !== null
  }

  holdsIn(root: string, path: string): boolean {
    const at = relativeTo(root, path)
    return (
      this.coverIn(root, path) !== null ||
      [...this.keysOf(root)].some((one) => under(one, at, root))
    )
  }

  moved(from: string, to: string, root = this.root(), into: string | null = root) {
    if (root === null || from === to) return

    const move = moving(from, to, root, into)
    const keys = [...this.keysOf(root)]
    const { left, went } = carried(
      keys,
      move,
      (one) => one,
      (_, path) => path,
    )
    if (left.length === keys.length) return

    const taken = keys.filter((one) => !left.includes(one))
    if (move.across) {
      void this.change(root, [], taken)
      if (went.length) void this.change(move.there, went, [])
    } else {
      void this.change(root, went, taken)
    }
  }

  change(root: string, archive: readonly string[], restore: readonly string[]): Promise<void> {
    return import('./archive-map').then(({ changed }) => {
      const next = changed(this.of(root), archive, restore, Date.now())
      if (next) this.put(root, next)
    })
  }

  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  adopt(root: string, theirs: unknown, accountId: string): Promise<void> {
    return import('./archive-map').then(({ fold }) => fold(this, root, theirs, accountId))
  }

  put(root: string, map: ArchiveMap, account: string | null = null) {
    const held = this.spaces[root]
    const whose = account ?? held?.account ?? null
    if (map === held?.map && whose === held.account) return

    this.spaces = { ...this.spaces, [root]: { map, account: whose } }
    this.write()
    if (account === null) this.soon(root)
  }

  soon(root: string) {
    clearTimeout(this.pushing[root])
    this.pushing[root] = setTimeout(
      () => void import('./archive-map').then(({ send }) => send(this, root)),
      700,
    )
  }

  private write() {
    keepJson(STORAGE_KEY, this.spaces)
  }
}
