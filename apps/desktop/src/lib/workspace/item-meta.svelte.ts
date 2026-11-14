import {
  metaOf,
  metaPatchOf,
  patched,
  sameMeta,
  type ItemMeta,
  type MetaPatch,
} from '@orden/sync-core'
import {
  insideItsSpace,
  movedTo,
  relativeTo,
  within,
  joinPath,
  isRecord,
  keepJson,
  stored,
  filledIn,
  readSpaces,
  without,
  withOrWithout,
} from '../platform/src/api'
import { carried, type Moving, moving } from './file-ops'

export const STORAGE_KEY = 'orden:item-meta'

const BURIED_KEY = 'orden:item-meta-buried'

const MOST_BURIED = 200

export interface Describing {
  describedIn(root: string): Readonly<Record<string, ItemMeta>> | null
  describe(root: string, patches: Readonly<Record<string, MetaPatch>>): Promise<string[] | null>
}

interface Kept {
  items: Record<string, ItemMeta>
  unsent: Record<string, MetaPatch>
  adopted: boolean
  moved: boolean
}

function itemsOf(value: unknown): Record<string, ItemMeta> {
  if (!isRecord(value)) return {}
  const out: Record<string, ItemMeta> = {}
  for (const [path, one] of Object.entries(value)) {
    const meta = insideItsSpace(path) ? metaOf(one) : null
    if (meta && Object.keys(meta).length) out[path] = meta
  }
  return out
}

function patchesOf(value: unknown): Record<string, MetaPatch> {
  if (!isRecord(value)) return {}
  const out: Record<string, MetaPatch> = {}
  for (const [path, one] of Object.entries(value)) {
    const patch = insideItsSpace(path) ? metaPatchOf(one) : null
    if (patch) out[path] = patch
  }
  return out
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({
    items: itemsOf(one.items),
    unsent: patchesOf(one.unsent),
    adopted: one.adopted === true,
    moved: one.moved === true,
  }))
}

function whole(meta: ItemMeta): MetaPatch {
  return { ...meta }
}

function merged(one: MetaPatch | undefined, other: MetaPatch): MetaPatch {
  return { ...one, ...other }
}

type Buried = Record<string, Record<string, ItemMeta>>

function readBuried(): Buried {
  const saved = stored(BURIED_KEY)
  if (!isRecord(saved)) return {}
  const out: Buried = {}
  for (const [back, items] of Object.entries(saved)) {
    if (!isRecord(items)) continue
    const kept: Record<string, ItemMeta> = {}
    for (const [at, one] of Object.entries(items)) {
      const meta = at === '' || insideItsSpace(at) ? metaOf(one) : null
      if (meta && Object.keys(meta).length) kept[at] = meta
    }
    if (Object.keys(kept).length) out[back] = kept
  }
  return out
}

function itemsUnder(items: Record<string, ItemMeta>, at: string, root: string) {
  const out: Record<string, ItemMeta> = {}
  for (const [path, meta] of Object.entries(items)) {
    const rest = within(at, path, root)
    if (rest !== null) out[rest] = meta
  }
  return out
}

const EMPTY: Kept = { items: {}, unsent: {}, adopted: false, moved: false }

export class ItemMetaStore {
  private spaces = $state<Record<string, Kept>>(read())
  private describing: Describing | null = null
  private hearing: ((path: string) => void)[] = []

  constructor(private readonly rootOf: (path: string | null) => string | null) {}

  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  private kept(root: string): Kept {
    return this.spaces[root] ?? EMPTY
  }

  itemsOf(root: string): Record<string, ItemMeta> {
    return this.kept(root).items
  }

  of(path: string, root = this.rootOf(path)): ItemMeta | null {
    if (root === null) return null
    return this.kept(root).items[relativeTo(root, path)] ?? null
  }

  valueOf(path: string, key: string, root = this.rootOf(path)): string | null {
    return this.of(path, root)?.[key] ?? null
  }

  movedFromText(root: string): boolean {
    return this.kept(root).moved
  }

  markMoved(root: string) {
    if (this.kept(root).moved) return
    this.spaces = { ...this.spaces, [root]: { ...this.kept(root), moved: true } }
    this.write()
  }

  set(path: string, patch: MetaPatch, root = this.rootOf(path)): void {
    if (root === null) return
    const at = relativeTo(root, path)
    if (!insideItsSpace(at)) return
    this.setMany(root, { [at]: patch })
  }

  setMany(root: string, patches: Readonly<Record<string, MetaPatch>>): void {
    const held = this.kept(root)
    let items = held.items
    let unsent = held.unsent
    const touched: string[] = []
    for (const [at, patch] of Object.entries(patches)) {
      const next = patched(items[at], patch)
      if (sameMeta(next, items[at])) continue
      touched.push(at)
      items = withOrWithout(items, at, next ?? null)
      unsent = { ...unsent, [at]: merged(unsent[at], patch) }
    }
    if (!touched.length) return
    this.spaces = { ...this.spaces, [root]: { ...held, items, unsent } }
    this.write()
    this.told(root, touched)
    void this.send(root)
  }

  hear(heard: (path: string) => void): () => void {
    this.hearing = [...this.hearing, heard]
    return () => {
      this.hearing = this.hearing.filter((one) => one !== heard)
    }
  }

  private told(root: string, paths: readonly string[]) {
    for (const at of paths) for (const heard of this.hearing) heard(joinPath(root, at))
  }

  describes(root: string): boolean {
    return (this.describing?.describedIn(root) ?? null) !== null
  }

  describeBy(describing: Describing): () => void {
    this.describing = describing
    return () => {
      if (this.describing === describing) this.describing = null
    }
  }

  async fromEngine(root: string): Promise<void> {
    if (!this.describes(root)) return
    const held = this.kept(root)
    if (!held.adopted) {
      const unsent = { ...held.unsent }
      for (const [at, meta] of Object.entries(held.items)) {
        unsent[at] = merged(whole(meta), unsent[at] ?? {})
      }
      this.spaces = { ...this.spaces, [root]: { ...held, unsent, adopted: true } }
      this.write()
    }
    await this.send(root)
    const heard = this.describing?.describedIn(root) ?? null
    if (heard === null) return
    const now = this.kept(root)
    let items: Record<string, ItemMeta> = { ...heard }
    for (const [at, patch] of Object.entries(now.unsent)) {
      items = withOrWithout(items, at, patched(items[at], patch) ?? null)
    }
    const changed = [...Object.keys(now.items), ...Object.keys(items)].filter(
      (at, index, all) => all.indexOf(at) === index && !sameMeta(now.items[at], items[at]),
    )
    if (!changed.length) return
    this.spaces = { ...this.spaces, [root]: { ...now, items } }
    this.write()
    this.told(root, changed)
  }

  private async send(root: string): Promise<void> {
    const describing = this.describing
    const held = this.kept(root)
    const waiting = Object.entries(held.unsent)
    if (!describing || !held.adopted || !waiting.length) return
    const left = await describing.describe(root, Object.fromEntries(waiting))
    if (left === null) return
    const after = this.kept(root)
    const sent = waiting.filter(([at]) => !left.includes(at))
    const unsent = Object.fromEntries(
      Object.entries(after.unsent).filter(
        ([at, patch]) =>
          !sent.some(([one, was]) => one === at && JSON.stringify(was) === JSON.stringify(patch)),
      ),
    )
    this.spaces = { ...this.spaces, [root]: { ...after, unsent } }
    this.write()
  }

  moved(from: string, to: string, root = this.rootOf(from), into: string | null = root) {
    if (root === null || from === to) return

    const move = moving(from, to, root, into)
    if (!move.was) return
    if (move.across) {
      this.carry(move)
      return
    }
    const now = move.now ?? ''
    const landing: string[] = []
    const rekeyed = <T>(held: Record<string, T>) => {
      const next: Record<string, T> = {}
      let touched = false
      for (const [path, value] of Object.entries(held)) {
        const landed = movedTo(path, move.was, now, root)
        next[landed ?? path] = value
        touched ||= landed !== null
        if (landed !== null) landing.push(landed)
      }
      return touched ? next : null
    }
    const held = this.kept(root)
    const items = rekeyed(held.items)
    if (!items) return
    const landed = [...landing]
    this.spaces = {
      ...this.spaces,
      [root]: { ...held, items, unsent: rekeyed(held.unsent) ?? held.unsent },
    }
    this.write()
    this.told(root, landed)
  }

  copied(from: string, to: string): void {
    const root = this.rootOf(from)
    const there = this.rootOf(to)
    if (root === null || there === null) return
    const was = relativeTo(root, from)
    const now = relativeTo(there, to)
    if (!was || !now) return
    const patches: Record<string, MetaPatch> = {}
    for (const [path, meta] of Object.entries(this.kept(root).items)) {
      const landed = movedTo(path, was, now, root)
      if (landed !== null) patches[landed] = whole(meta)
    }
    this.setMany(there, patches)
  }

  private carry(move: Moving) {
    const held = this.kept(move.root)
    const across = <T>(map: Record<string, T>) =>
      carried(
        Object.entries(map),
        move,
        ([path]) => path,
        ([, value], path): [string, T] => [path, value],
      )
    const items = across(held.items)
    if (!items.went.length && items.left.length === Object.keys(held.items).length) return
    const unsent = across(held.unsent)
    const there = this.kept(move.there)
    const went: Record<string, MetaPatch> = {
      ...there.unsent,
      ...Object.fromEntries(items.went.map(([path, meta]) => [path, whole(meta)])),
    }
    this.spaces = {
      ...this.spaces,
      [move.root]: {
        ...held,
        items: Object.fromEntries(items.left),
        unsent: Object.fromEntries(unsent.left),
      },
      [move.there]: {
        ...there,
        items: { ...there.items, ...Object.fromEntries(items.went) },
        unsent: went,
      },
    }
    this.write()
    this.told(
      move.there,
      items.went.map(([path]) => path),
    )
    void this.send(move.there)
  }

  gone(path: string, root = this.rootOf(path), back?: string) {
    if (root === null) return
    const at = relativeTo(root, path)
    if (!at) return
    const held = this.kept(root)
    if (back) this.bury(back, itemsUnder(held.items, at, root))
    const kept = <T>(map: Record<string, T>) =>
      Object.fromEntries(Object.entries(map).filter(([one]) => within(at, one, root) === null))
    const items = kept(held.items)
    if (Object.keys(items).length === Object.keys(held.items).length) return
    this.spaces = { ...this.spaces, [root]: { ...held, items, unsent: kept(held.unsent) } }
    this.write()
  }

  cameBack(path: string, root = this.rootOf(path), back?: string) {
    if (root === null || !back) return
    const buried = readBuried()
    const items = buried[back]
    if (!items) return
    const at = relativeTo(root, path)
    if (!at) return
    const patches: Record<string, MetaPatch> = {}
    for (const [rest, meta] of Object.entries(items)) {
      const landed = rest ? `${at}/${rest}` : at
      if (insideItsSpace(landed) && !this.kept(root).items[landed]) patches[landed] = whole(meta)
    }
    keepJson(BURIED_KEY, without(buried, back))
    this.setMany(root, patches)
  }

  private bury(back: string, items: Record<string, ItemMeta>) {
    if (!Object.keys(items).length) return
    const buried = Object.entries({ ...without(readBuried(), back), [back]: items })
    keepJson(BURIED_KEY, Object.fromEntries(buried.slice(-MOST_BURIED)))
  }

  spaceMoved(from: string, to: string) {
    const held = this.spaces[from]
    if (!held || from === to) return
    this.spaces = { ...without(this.spaces, from), [to]: held }
    this.write()
  }

  forget(root: string) {
    if (!(root in this.spaces)) return
    this.spaces = without(this.spaces, root)
    this.write()
  }

  private write() {
    keepJson(STORAGE_KEY, this.spaces)
  }
}
