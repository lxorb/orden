import { insideItsSpace, movedTo, relativeTo, within } from '../space-paths'
import { isRecord, keepJson, stored } from '../stored'
import { type Folded, readSpaces, without } from '../records'
import { carried, moving } from '../workspace/file-ops'
import type { Cost } from './scrypt'
import { unlocks } from './unlocked.svelte'

export const STORAGE_KEY = 'nib:protected'
const PASSWORD_KEY = 'nib:protect-password'

export type Way = 'password' | 'device'

export const SPACE = ''

const MOST_PROTECTED = 400

export interface Lock {
  root: string
  key: string
  way: Way
}

export interface Hashed extends Cost {
  salt: string
  hash: string
}

const MOST_N = 1 << 20

export function hashedOf(value: unknown): Hashed | null {
  if (typeof value !== 'object' || value === null) return null
  const { n, r, p, salt, hash } = value as Record<string, unknown>
  const whole = (one: unknown, most: number): one is number =>
    Number.isInteger(one) && (one as number) > 0 && (one as number) <= most
  if (!whole(n, MOST_N) || (n & (n - 1)) !== 0 || !whole(r, 32) || !whole(p, 16)) return null
  if (typeof salt !== 'string' || typeof hash !== 'string') return null
  if (!/^[A-Za-z0-9+/=]{4,64}$/.test(salt) || !/^[A-Za-z0-9+/=]{4,128}$/.test(hash)) return null
  return { n, r, p, salt, hash }
}

const isWay = (value: unknown): value is Way => value === 'password' || value === 'device'

export function protectedMap(value: unknown): Record<string, Way> {
  if (!isRecord(value)) return {}
  const out: Record<string, Way> = {}
  for (const [path, way] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_PROTECTED) break
    if ((path === SPACE || insideItsSpace(path)) && isWay(way)) out[path] = way
  }
  return out
}

interface Kept extends Folded {
  ways: Record<string, Way>
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({ ways: protectedMap(one.ways) }))
}

function covers(key: string, at: string, root: string): boolean {
  return key === SPACE || within(key, at, root) !== null
}

export class Protection {
  private spaces = $state<Record<string, Kept>>(read())
  private hashed = $state<Hashed | null>(hashedOf(stored(PASSWORD_KEY)))

  get any(): boolean {
    return Object.values(this.spaces).some((one) => Object.keys(one.ways).length > 0)
  }

  locked(path: string | null | undefined): boolean {
    return !!path && this.any && unlocks.shut(this.covering(path))
  }

  get password(): Hashed | null {
    return this.hashed
  }

  setPassword(hashed: Hashed | null): void {
    this.hashed = hashed
    keepJson(PASSWORD_KEY, hashed)
  }

  covering(path: string): Lock[] {
    const out: Lock[] = []
    for (const [root, kept] of Object.entries(this.spaces)) {
      const at = within(root, path, root)
      if (at === null) continue
      for (const [key, way] of Object.entries(kept.ways)) {
        if (covers(key, at, root)) out.push({ root, key, way })
      }
    }
    return out
  }

  own(root: string, path: string): Lock | null {
    const key = path === root ? SPACE : relativeTo(root, path)
    const way = this.spaces[root]?.ways[key]
    return way ? { root, key, way } : null
  }

  ways(root: string): Record<string, Way> {
    return this.spaces[root]?.ways ?? {}
  }

  set(root: string, path: string, way: Way | null): void {
    const key = path === root ? SPACE : relativeTo(root, path)
    if (key !== SPACE && !insideItsSpace(key)) return
    const held = this.ways(root)
    if (way === null) {
      if (key in held) this.put(root, without(held, key))
      return
    }
    if (!(key in held) && Object.keys(held).length >= MOST_PROTECTED) return
    this.put(root, { ...held, [key]: way })
  }

  moved(from: string, to: string, root: string | null, into: string | null = root): void {
    if (root === null || from === to) return
    const move = moving(from, to, root, into)
    if (!move.was) return
    const held = Object.entries(this.ways(root)).filter(([key]) => key !== SPACE)
    if (move.across) {
      const { left, went } = carried(
        held,
        move,
        ([key]) => key,
        ([, way], path) => [path, way] as [string, Way],
      )
      if (!went.length && left.length === held.length) return
      const space = this.ways(root)[SPACE]
      this.put(root, Object.fromEntries(space ? [...left, [SPACE, space]] : left))
      if (went.length)
        this.put(move.there, { ...this.ways(move.there), ...Object.fromEntries(went) })
      return
    }
    let changed = false
    const next: Record<string, Way> = {}
    for (const [key, way] of Object.entries(this.ways(root))) {
      const now = key === SPACE ? key : (movedTo(key, move.was, move.now ?? '', root) ?? key)
      if (now !== key) changed = true
      next[now] = way
    }
    if (changed) this.put(root, next)
  }

  gone(path: string, root: string | null): void {
    if (root === null) return
    const at = relativeTo(root, path)
    const held = this.ways(root)
    const next = Object.fromEntries(
      Object.entries(held).filter(([key]) => key === SPACE || within(at, key, root) === null),
    )
    if (Object.keys(next).length !== Object.keys(held).length) this.put(root, next)
  }

  spaceMoved(from: string, to: string): void {
    const kept = this.spaces[from]
    if (!kept || from === to) return
    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  forget(root: string): void {
    if (!(root in this.spaces)) return
    this.spaces = without(this.spaces, root)
    this.write()
  }

  private put(root: string, ways: Record<string, Way>): void {
    this.spaces = { ...this.spaces, [root]: { ways, account: this.spaces[root]?.account ?? null } }
    this.write()
  }

  private write(): void {
    keepJson(STORAGE_KEY, this.spaces)
  }
}
