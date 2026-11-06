import { insideItsSpace, movedTo, relativeTo, within } from '../space-paths'
import { isRecord, keepJson, stored } from '../stored'
import { type Folded, type Folding, meet, readSpaces, without } from '../records'
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
  at?: number
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
  const at = (value as Record<string, unknown>).at
  return {
    n,
    r,
    p,
    salt,
    hash,
    ...(typeof at === 'number' && whole(at, Number.MAX_SAFE_INTEGER) ? { at } : {}),
  }
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
  sent: boolean
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({
    ways: protectedMap(one.ways),
    sent: one.sent !== false,
  }))
}

function same(one: Record<string, Way>, other: Record<string, Way>): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

const WAYS: Folding<Record<string, Way>> = {
  fold: (theirs, mine) => ({ ...theirs, ...mine }),
  same,
}

const synced = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./synced')

function covers(key: string, at: string, root: string): boolean {
  return key === SPACE || within(key, at, root) !== null
}

export class Protection {
  private spaces = $state<Record<string, Kept>>(read())
  private revision = $state(0)
  private hashed = $state<Hashed | null>(hashedOf(stored(PASSWORD_KEY)))

  get any(): boolean {
    return Object.values(this.spaces).some((one) => Object.keys(one.ways).length > 0)
  }

  get seen(): string {
    return `${String(this.revision)}:${String(unlocks.revision)}`
  }

  locked(path: string | null | undefined): boolean {
    return !!path && this.any && unlocks.shut(this.covering(path))
  }

  shutIn(root: string): string[] | null {
    const shut = Object.entries(this.ways(root))
      .filter(([key, way]) => unlocks.shut([{ root, key, way }]))
      .map(([key]) => key)
    return shut.includes(SPACE) ? null : shut
  }

  agentsMay(path: string | null | undefined): boolean {
    if (!path || !this.any) return true
    const locks = this.covering(path)
    return !locks.length || unlocks.agentsMay(locks)
  }

  get password(): Hashed | null {
    return this.hashed
  }

  setPassword(hashed: Hashed | null): void {
    this.hashed = hashed && { ...hashed, at: Date.now() }
    keepJson(PASSWORD_KEY, this.hashed)
    if (this.hashed)
      void synced()
        .then((one) => one.pushPassword())
        .catch(() => undefined)
  }

  adoptPassword(theirs: Hashed | null): boolean {
    const mine = this.hashed
    if (theirs && (!mine || (mine.at ?? 0) < (theirs.at ?? 0))) {
      this.hashed = theirs
      keepJson(PASSWORD_KEY, theirs)
      return false
    }
    return !!mine && (!theirs || (mine.at ?? 0) > (theirs.at ?? 0))
  }

  adopt(root: string, theirs: Record<string, Way>, accountId: string): boolean {
    const held = this.spaces[root]
    const met = meet(held, accountId, held?.ways ?? {}, protectedMap(theirs), WAYS)
    if (!met) return false
    this.spaces = {
      ...this.spaces,
      [root]: { ways: met.value, account: accountId, sent: !met.tell },
    }
    this.write()
    return met.tell
  }

  said(root: string, landed: boolean): void {
    const held = this.spaces[root]
    if (!held || held.sent === landed) return
    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    keepJson(STORAGE_KEY, this.spaces)
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
    const account = this.spaces[root]?.account ?? null
    this.spaces = { ...this.spaces, [root]: { ways, account, sent: false } }
    this.write()
    void synced()
      .then((one) => one.pushWays(root))
      .catch(() => undefined)
  }

  private write(): void {
    this.revision++
    keepJson(STORAGE_KEY, this.spaces)
  }
}

export const protection = new Protection()
