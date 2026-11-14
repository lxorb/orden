import {
  insideItsSpace,
  movedTo,
  relativeTo,
  samePath,
  within,
  isString,
  keepJson,
  filledIn,
  type Folded,
  type Folding,
  meet,
  readSpaces,
  without,
} from '../platform/src/api'
import { carried, moving } from './file-ops'

export const STORAGE_KEY = 'orden:excluded'

export const MOST_EXCLUDED = 200

export function excludedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  for (const one of value) {
    if (out.length >= MOST_EXCLUDED) break
    if (isString(one) && insideItsSpace(one) && !out.includes(one)) out.push(one)
  }

  return out
}

interface Kept extends Folded {
  paths: string[]
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({ paths: excludedPaths(one.paths) }))
}

function same(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((path, at) => path === other[at])
}

const PATHS: Folding<string[]> = {
  fold: (theirs, mine) => [...theirs, ...mine.filter((one) => !theirs.includes(one))],
  same,
}

function under(path: string, excluded: string, root?: string): boolean {
  return !!excluded && within(excluded, path, root) !== null
}

export class Excluded {
  private spaces = $state<Record<string, Kept>>(read())

  constructor(private readonly root: () => string | null) {}

  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): string[] {
    return this.spaces[root]?.paths ?? []
  }

  get here(): string[] {
    const root = this.root()
    return root === null ? [] : this.of(root)
  }

  has(path: string): boolean {
    const root = this.root()
    if (root === null) return false

    const held = this.of(root)
    if (!held.length) return false

    const at = relativeTo(root, path)
    return held.some((one) => under(at, one))
  }

  names(path: string): boolean {
    const root = this.root()
    if (root === null) return false

    const at = relativeTo(root, path)
    return this.of(root).some((one) => samePath(one, at, root))
  }

  toggle(path: string) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    if (!insideItsSpace(at)) return

    const held = this.of(root)
    if (held.some((one) => samePath(one, at, root))) {
      this.put(
        root,
        held.filter((one) => !samePath(one, at, root)),
      )
      return
    }

    if (held.length >= MOST_EXCLUDED) return
    if (held.some((one) => under(at, one, root))) return

    this.put(root, [...held.filter((one) => !under(one, at, root)), at])
  }

  moved(from: string, to: string, root = this.root(), into: string | null = root) {
    if (root === null || from === to) return

    const move = moving(from, to, root, into)
    const { was, now } = move
    if (!was) return

    const held = this.of(root)
    if (move.across) {
      const { left, went } = carried(
        held,
        move,
        (one) => one,
        (_, path) => path,
      )
      if (!went.length && left.length === held.length) return
      this.put(root, left)
      if (went.length) this.leaveOut(move.there, went)
      return
    }

    const next = held.map((one) => movedTo(one, was, now ?? '', root) ?? one)
    if (!same(held, next)) this.put(root, next)
  }

  private leaveOut(root: string, paths: readonly string[]) {
    let held = this.of(root)
    for (const at of paths) {
      if (held.length >= MOST_EXCLUDED) break
      if (held.some((one) => under(at, one, root))) continue
      held = [...held.filter((one) => !under(one, at, root)), at]
    }
    if (!same(held, this.of(root))) this.put(root, held)
  }

  gone(path: string, root = this.root()) {
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    const next = held.filter((one) => !under(one, at, root))

    if (!same(held, next)) this.put(root, next)
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

  adopt(root: string, theirs: unknown, accountId: string) {
    const account = excludedPaths(theirs)
    const held = this.spaces[root]
    const met = meet(held, accountId, held?.paths ?? [], account, PATHS)
    if (!met) return

    this.spaces = { ...this.spaces, [root]: { paths: met.value, account: accountId } }
    this.write()

    if (met.tell) void this.push(root)
  }

  private put(root: string, paths: string[]) {
    this.spaces = {
      ...this.spaces,
      [root]: { paths, account: this.spaces[root]?.account ?? null },
    }
    this.write()
    void this.push(root)
  }

  private async push(root: string) {
    const { push } = await import('./pushing')
    await push(root, (api, token, spaceId) => api.saveExcluded(token, spaceId, this.of(root)))
  }

  private write() {
    keepJson(STORAGE_KEY, this.spaces)
  }
}
