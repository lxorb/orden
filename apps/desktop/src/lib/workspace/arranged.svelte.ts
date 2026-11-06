import { untrack } from 'svelte'
import { door } from '@orden/markdown/door'
import { insideItsSpace, movedTo, nameOf, relativeTo, samePath, within } from '../space-paths'
import { isRecord, isString, keepJson, recordOf, stored } from '../stored'
import { FIRST_MODE, isSortMode, renamedIn, type SortMode, withoutName } from '../tree-order'
import { filledIn, type Folded, type Folding, meet, readSpaces, without } from '../records'
import { carried, type Moving, moving } from './file-ops'

export const STORAGE_KEY = 'nib:arranged'

export const MOST_ARRANGED = 200

export const MOST_NAMES = 500

const LONGEST_NAME = 255

function isName(value: unknown): value is string {
  return (
    isString(value) &&
    !!value &&
    value.length <= LONGEST_NAME &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..' &&
    !/\p{Cc}/u.test(value)
  )
}

function isFolderKey(key: string): boolean {
  return key === '' || insideItsSpace(key)
}

function namesIn(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  for (const one of value) {
    if (out.length >= MOST_NAMES) break
    if (isName(one) && !out.includes(one)) out.push(one)
  }

  return out
}

export function arrangedMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}

  const out: Record<string, string[]> = {}
  for (const [folder, names] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_ARRANGED) break
    if (!isFolderKey(folder)) continue

    const kept = namesIn(names)
    if (kept.length) out[folder] = kept
  }

  return out
}

interface Kept extends Folded {
  folders: Record<string, string[]>
  sent: boolean
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({
    folders: arrangedMap(one.folders),
    sent: one.sent !== false,
  }))
}

function sameNames(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((name, at) => name === other[at])
}

const SETTLING = 700

interface Showing {
  root: string
  folder: string
  names: string[]
}

export interface Positioned {
  namesIn(root: string, folder: string): readonly string[] | null
  folders(root: string): ReadonlyMap<string, readonly string[]>
  arrange(
    root: string,
    folder: string,
    names: readonly string[],
  ): { drawn: readonly string[]; done: Promise<unknown> } | null
}

export class Arranged {
  private spaces = $state<Record<string, Kept>>(read())
  private showing = $state<Showing | null>(null)
  private positioned: Positioned | null = null
  private placings = $state(0)
  private placing = $state.raw<Record<string, readonly string[]>>({})
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}
  private readonly talking = door(() => import('./arranging'))

  constructor(private readonly root: () => string | null) {}

  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): Record<string, string[]> {
    return this.spaces[root]?.folders ?? {}
  }

  placeBy(positioned: Positioned): () => void {
    this.positioned = positioned
    this.repositioned()
    return () => {
      if (this.positioned !== positioned) return
      this.positioned = null
      this.repositioned()
    }
  }

  repositioned() {
    this.placings += 1
  }

  private placed(root: string, at: string): readonly string[] | null {
    const pending = this.placing[placingKey(root, at)]
    if (pending) return pending
    const positioned = this.placings >= 0 ? this.positioned : null
    return positioned?.namesIn(root, at) ?? null
  }

  fromPlaces(root: string) {
    const positioned = this.positioned
    if (!positioned) return
    for (const [at, names] of Object.entries(this.of(root))) {
      if (positioned.namesIn(root, at) === null) positioned.arrange(root, at, names)
    }
    for (const [at, names] of positioned.folders(root)) this.keep(root, at, [...names])
  }

  listOf(folder: string): readonly string[] {
    const root = this.root()
    if (root === null) return []

    const at = relativeTo(root, folder)
    const shown = this.showing
    if (shown && samePath(shown.root, root) && shown.folder === at) return shown.names

    return this.placed(root, at) ?? this.of(root)[at] ?? []
  }

  savedList(folder: string): readonly string[] {
    const root = this.root()
    if (root === null) return []

    const at = relativeTo(root, folder)
    return this.placed(root, at) ?? this.of(root)[at] ?? []
  }

  get dragging(): boolean {
    return this.showing !== null
  }

  show(folder: string, names: readonly string[]) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, folder)
    if (!isFolderKey(at)) return

    const shown = this.showing
    if (shown?.folder === at && sameNames(shown.names, names)) return

    this.showing = { root, folder: at, names: [...names] }
  }

  unshow() {
    this.showing = null
  }

  drop() {
    const shown = this.showing
    this.showing = null
    if (!shown) return

    this.write(shown.root, shown.folder, shown.names)
  }

  set(folder: string, names: readonly string[]) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, folder)
    if (!isFolderKey(at)) return

    this.write(root, at, [...names])
  }

  private write(root: string, at: string, names: string[]) {
    const placing = this.positioned?.arrange(root, at, names)
    if (placing) {
      const key = placingKey(root, at)
      this.placing = { ...this.placing, [key]: placing.drawn }
      const done = () => {
        if (this.placing[key] === placing.drawn) this.placing = without(this.placing, key)
        this.repositioned()
      }
      placing.done.then(done, done)
    }
    this.keep(root, at, names)
  }

  private keep(root: string, at: string, names: string[]) {
    const held = this.of(root)
    const kept = namesIn(names)
    const there = held[at] ?? []

    if (sameNames(there, kept)) return
    if (kept.length && !(at in held) && Object.keys(held).length >= MOST_ARRANGED) return

    this.put(root, kept.length ? { ...held, [at]: kept } : without(held, at))
  }

  moved(from: string, to: string, root = this.root(), into: string | null = root) {
    if (root === null || from === to) return

    const move = moving(from, to, root, into)
    const { was } = move
    if (!was) return

    const held = this.of(root)
    if (move.across) {
      this.carry(move)
      return
    }
    const now = move.now ?? ''
    let next = held

    const rekeyed: Record<string, string[]> = {}
    let touched = false
    for (const [folder, names] of Object.entries(held)) {
      const moved = movedTo(folder, was, now, root)
      rekeyed[moved ?? folder] = names
      touched ||= moved !== null
    }
    if (touched) next = rekeyed

    const owner = folderKeyOf(was)
    const listed = next[owner]
    if (listed) {
      const under =
        folderKeyOf(now) === owner
          ? renamedIn(listed, nameOf(was), nameOf(now))
          : withoutName(listed, nameOf(was))
      if (under) next = withList(next, owner, under)
    }

    if (next !== held) this.put(root, next)
  }

  private carry(move: Moving) {
    const held = this.of(move.root)
    const { left, went } = carried(
      Object.entries(held),
      move,
      ([folder]) => folder,
      ([, names], folder): [string, string[]] => [folder, names],
    )
    let next = Object.fromEntries(left)
    const owner = folderKeyOf(move.was)
    const listed = next[owner]
    const under = listed && withoutName(listed, nameOf(move.was))
    if (under) next = withList(next, owner, under)
    if (left.length !== Object.keys(held).length || under) this.put(move.root, next)

    if (!went.length) return
    const there = { ...this.of(move.there) }
    for (const [folder, names] of went) {
      if (Object.keys(there).length >= MOST_ARRANGED && !(folder in there)) break
      there[folder] = names
    }
    this.put(move.there, there)
  }

  gone(path: string, root = this.root()) {
    if (root === null) return

    const at = relativeTo(root, path)
    if (!at) return

    const held = this.of(root)
    let next: Record<string, string[]> = {}
    let touched = false

    for (const [folder, names] of Object.entries(held)) {
      if (within(at, folder, root) !== null) {
        touched = true
        continue
      }
      next[folder] = names
    }

    const owner = folderKeyOf(at)
    const name = nameOf(at)
    const listed = next[owner]
    if (listed?.includes(name)) {
      next = withList(
        next,
        owner,
        listed.filter((one) => one !== name),
      )
      touched = true
    }

    if (touched) this.put(root, next)
  }

  spaceMoved(from: string, to: string) {
    const held = this.spaces[from]
    if (!held || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: held }
    this.writeAll()
  }

  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.writeAll()
  }

  adopt(root: string, theirs: unknown, accountId: string): Promise<void> {
    return this.reaching().then(({ fold }) => fold(this, root, theirs, accountId))
  }

  kept(root: string): { folders: Record<string, string[]>; account: string | null; sent: boolean } {
    const held = this.spaces[root]
    return {
      folders: held?.folders ?? {},
      account: held?.account ?? null,
      sent: held?.sent !== false,
    }
  }

  took(root: string, folders: Record<string, string[]>, account: string) {
    this.spaces = { ...this.spaces, [root]: { folders, account, sent: true } }
    this.writeAll()
  }

  said(root: string, landed: boolean) {
    const held = this.spaces[root]
    if (!held || held.sent === landed) return

    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.writeAll()
  }

  private put(root: string, folders: Record<string, string[]>) {
    this.spaces = {
      ...this.spaces,
      [root]: { folders, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.writeAll()
    this.soon(root)
  }

  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)

    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      void this.reaching().then(({ send }) => send(this, root))
    }, SETTLING)

    this.pushing = { ...this.pushing, [root]: waiting }
  }

  private reaching(): Promise<typeof import('./arranging')> {
    return this.talking()
  }

  private writeAll() {
    keepJson(STORAGE_KEY, this.spaces)
  }
}

function placingKey(root: string, at: string): string {
  return `${root}\u0000${at}`
}

function folderKeyOf(at: string): string {
  const cut = at.lastIndexOf('/')
  return cut < 0 ? '' : at.slice(0, cut)
}

function withList(
  held: Record<string, string[]>,
  folder: string,
  names: string[],
): Record<string, string[]> {
  return names.length ? { ...held, [folder]: names } : without(held, folder)
}

export const SORT_KEY = 'nib:sorting'

const BEFORE = 'nib:list-order'

interface Sorted extends Folded {
  mode: SortMode
  sent: boolean
}

function readSorts(): Record<string, Sorted> {
  const kept = readSpaces(SORT_KEY, (one) => ({
    mode: isSortMode(one.mode) ? one.mode : FIRST_MODE,
    sent: one.sent !== false,
  }))
  if (Object.keys(kept).length || isRecord(stored(SORT_KEY))) return kept

  const before = recordOf(stored(BEFORE), isSortMode)
  const taken = Object.fromEntries(
    Object.entries(before).map(([root, mode]) => [root, { mode, account: null, sent: true }]),
  )
  if (Object.keys(taken).length) keepJson(SORT_KEY, taken)
  return taken
}

const ORDER: Folding<SortMode> = {
  fold: (theirs, mine) => (theirs === FIRST_MODE ? mine : theirs),
  same: (one, other) => one === other,
}

export class SpaceSorting {
  private spaces = $state<Record<string, Sorted>>(readSorts())

  constructor(private readonly root: () => string | null) {}

  reread(): void {
    const grown = filledIn(this.spaces, readSorts())
    if (grown) this.spaces = grown
  }

  of(root: string): SortMode {
    return this.spaces[root]?.mode ?? FIRST_MODE
  }

  set(mode: SortMode) {
    const root = this.root()
    if (root === null || this.of(root) === mode) return

    this.keepAs(root, mode, this.spaces[root]?.account ?? null, false)
    void this.push(root)
  }

  adopt(root: string, theirs: unknown, accountId: string) {
    if (theirs === undefined) return
    untrack(() => {
      const account = isSortMode(theirs) ? theirs : FIRST_MODE
      const kept = this.spaces[root]
      if (kept?.sent === false && kept.account === accountId) {
        if (kept.mode === account) this.keepAs(root, account, accountId, true)
        else void this.push(root)
        return
      }
      const met = meet(kept, accountId, kept?.mode ?? FIRST_MODE, account, ORDER)
      if (!met) return

      this.keepAs(root, met.value, accountId, !met.tell)
      if (met.tell) void this.push(root)
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

  private keepAs(root: string, mode: SortMode, account: string | null, sent: boolean) {
    this.spaces = { ...this.spaces, [root]: { mode, account, sent } }
    this.write()
  }

  private async push(root: string) {
    const { push } = await import('./pushing')
    await push(
      root,
      (api, token, spaceId) => api.saveSort(token, spaceId, this.of(root)),
      (landed) => {
        const kept = this.spaces[root]
        if (kept && !landed) this.keepAs(root, kept.mode, kept.account, false)
      },
    )
  }

  private write() {
    keepJson(SORT_KEY, this.spaces)
  }
}
