import { foreignCopy, inForeignCopy } from '@orden/sync-core'
import {
  foldsIn,
  insideItsSpace,
  insideSpace,
  movedTo,
  pathKeyAs,
  relativeTo,
  samePath,
  within,
  forget,
  isRecord,
  keep,
  keepJson,
  stored,
  storedText,
  type Folded,
  type Folding,
  meet,
  readSpaces,
  without,
} from '../../platform/src/api'
import { carried, moving, type Moving } from '../../file-ops/src/api'
import type { Cost } from './scrypt'
import { unlocks } from './unlocked.svelte'

export const STORAGE_KEY = 'orden:protected'
const PASSWORD_KEY = 'orden:protect-password'
const OWNER_KEY = 'orden:protect-password-account'

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

const MOST_WORK = 1 << 19

export function hashedOf(value: unknown): Hashed | null {
  if (typeof value !== 'object' || value === null) return null
  const { n, r, p, salt, hash } = value as Record<string, unknown>
  const whole = (one: unknown, most: number): one is number =>
    Number.isInteger(one) && (one as number) > 0 && (one as number) <= most
  if (!whole(n, MOST_N) || (n & (n - 1)) !== 0 || !whole(r, 32) || !whole(p, 16)) return null
  if (n * r * p > MOST_WORK) return null
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

export const lockable = (key: string) => insideItsSpace(key.replace(/^[A-Za-z]:/, '_'))

export const fitted = (key: string) =>
  key.length > 300 ? key.slice(0, 300).replace(/\/?[^/]*$/, '') : key

export function protectedMap(value: unknown): Record<string, Way> {
  if (!isRecord(value)) return {}
  const out: Record<string, Way> = {}
  for (const [key, way] of Object.entries(value)) {
    const path = fitted(key)
    if (Object.keys(out).length >= MOST_PROTECTED) break
    if ((path === SPACE || lockable(path)) && isWay(way)) out[path] = way
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

export const buried = () => import('./buried')

const synced = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./synced')

interface Shut {
  folds: boolean
  keys: { key: string; under: string }[]
}

function copiedFrom(path: string): string | null {
  if (!inForeignCopy(path)) return null
  return path
    .split(/([\\/])/)
    .map((part) => foreignCopy(part)?.original ?? part)
    .join('')
}

function holderOf(path: string): string | null {
  return /\.pages\.pdf$/i.test(path) ? path.slice(0, -'.pdf'.length) : null
}

function originalsOf(path: string): string[] {
  const copy = copiedFrom(path)
  const found = [copy, holderOf(path), copy === null ? null : holderOf(copy)]
  return [...new Set(found.filter((one) => one !== null))]
}

function paperMoving(from: string, to: string): [string, string] | null {
  return /\.pages$/i.test(from) && /\.pages$/i.test(to) ? [`${from}.pdf`, `${to}.pdf`] : null
}

function covers(key: string, at: string, root: string): boolean {
  return key === SPACE || within(key, at, root) !== null
}

export class Protection {
  private spaces = $state<Record<string, Kept>>(read())
  private revision = $state(0)
  private hashed = $state<Hashed | null>(hashedOf(stored(PASSWORD_KEY)))
  private owner: string | null = storedText(OWNER_KEY)
  private heard = storedText(STORAGE_KEY)

  constructor() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    window.addEventListener('storage', (event) => {
      const key = event.key
      if (key === STORAGE_KEY || key === null) this.reread()
      if (key === PASSWORD_KEY || key === null) this.hashed = hashedOf(stored(PASSWORD_KEY))
      if (key === OWNER_KEY || key === null) this.owner = storedText(OWNER_KEY)
    })
  }

  private reread(): void {
    const text = storedText(STORAGE_KEY)
    if (text === this.heard) return
    this.heard = text
    this.spaces = read()
    this.revision++
  }

  get any(): boolean {
    return Object.values(this.spaces).some((one) => Object.keys(one.ways).length > 0)
  }

  get count(): number {
    return Object.values(this.spaces).reduce((sum, one) => sum + Object.keys(one.ways).length, 0)
  }

  get seen(): string {
    return `${String(this.revision)}:${String(unlocks.revision)}`
  }

  private shutHeld: { spaces: Record<string, Kept>; revision: number; shut: Shut[] } | null = null

  private shutNow(): Shut[] {
    const spaces = this.spaces
    const revision = unlocks.revision
    const held = this.shutHeld
    if (held?.spaces === spaces && held.revision === revision) return held.shut
    const shut = Object.entries(spaces)
      .map(([root, kept]) => {
        const folds = foldsIn(root)
        return {
          folds,
          keys: Object.entries(kept.ways)
            .filter(([key, way]) => unlocks.shut([{ root, key, way }]))
            .map(([key]) => pathKeyAs(key === SPACE ? root : insideSpace(root, key), folds))
            .map((key) => ({ key, under: `${key}/` })),
        }
      })
      .filter((one) => one.keys.length)
    this.shutHeld = { spaces, revision, shut }
    return shut
  }

  locked(path: string | null | undefined): boolean {
    if (!path) return false
    const shut = this.shutNow()
    if (!shut.length) return false
    return this.shutAt(shut, path) || originalsOf(path).some((one) => this.shutAt(shut, one))
  }

  private shutAt(shut: Shut[], path: string): boolean {
    const exact = pathKeyAs(path, false)
    let folded: string | null = null
    return shut.some(({ folds, keys }) => {
      const at = folds ? (folded ??= exact.toLowerCase()) : exact
      return keys.some(({ key, under }) => at === key || at.startsWith(under))
    })
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
    this.owner = null
    forget(OWNER_KEY)
    if (this.hashed)
      void synced()
        .then((one) => one.pushPassword())
        .catch(() => undefined)
  }

  adoptPassword(theirs: Hashed | null, accountId: string): boolean {
    const foreign = this.owner !== null && this.owner !== accountId
    const mine = foreign ? null : this.hashed
    if (theirs && (!mine || (mine.at ?? 0) < (theirs.at ?? 0))) {
      this.hashed = theirs
      keepJson(PASSWORD_KEY, theirs)
      this.ownedBy(accountId)
      return false
    }
    if (!mine) return false
    this.ownedBy(accountId)
    return !theirs || (mine.at ?? 0) > (theirs.at ?? 0)
  }

  ownedBy(accountId: string): void {
    if (this.owner === accountId) return
    this.owner = accountId
    keep(OWNER_KEY, accountId)
  }

  adopt(root: string, theirs: Record<string, Way>, accountId: string): boolean {
    this.reread()
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
    this.reread()
    const held = this.spaces[root]
    if (!held || held.sent === landed) return
    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.keepSpaces()
  }

  covering(path: string): Lock[] {
    const out = this.coveringAt(path)
    for (const original of originalsOf(path)) {
      for (const one of this.coveringAt(original)) {
        if (!out.some((mine) => mine.key === one.key && samePath(mine.root, one.root)))
          out.push(one)
      }
    }
    return out
  }

  private coveringAt(path: string): Lock[] {
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

  marked(root: string, path: string): boolean {
    if (this.own(root, path)) return true
    const original = copiedFrom(path)
    return original !== null && this.own(root, original) !== null
  }

  ways(root: string): Record<string, Way> {
    return this.spaces[root]?.ways ?? {}
  }

  set(root: string, path: string, way: Way | null): void {
    this.reread()
    const key = path === root ? SPACE : relativeTo(root, path)
    if (key !== SPACE && !lockable(fitted(key))) return
    const held = this.ways(root)
    if (way === null) {
      if (key in held) this.put(root, without(held, key))
      return
    }
    if (!(key in held) && Object.keys(held).length >= MOST_PROTECTED) return
    this.put(root, { ...held, [key]: way })
  }

  private filesNear: (path: string) => readonly string[] = () => []

  seesFiles(near: (path: string) => readonly string[]): void {
    this.filesNear = near
  }

  heldWithin(root: string, path: string): string[] {
    const at = relativeTo(root, path)
    const original = copiedFrom(path)
    const was = original === null ? null : relativeTo(root, original)
    const held: string[] = []
    for (const key of Object.keys(this.ways(root))) {
      if (key === SPACE) continue
      if (within(at, key, root) !== null) held.push(key)
      const mapped = was === null ? null : movedTo(key, was, at, root)
      if (mapped !== null && mapped !== key) held.push(mapped)
    }
    return held
  }

  private insideCopiesKept(path: string, root: string): void {
    if (!this.any || copiedFrom(path) === null) return
    const own = this.ways(root)
    const came: Record<string, Way> = {}
    for (const key of this.heldWithin(root, path)) {
      if (key in own || !lockable(fitted(key))) continue
      const way = this.covering(insideSpace(root, key))[0]?.way
      if (way) came[key] = way
    }
    if (Object.keys(came).length) this.put(root, { ...own, ...came })
  }

  private copiesKept(path: string, root: string): void {
    this.insideCopiesKept(path, root)
    if (!this.any) return
    const came: Record<string, Way> = {}
    for (const one of this.filesNear(path)) {
      const original = copiedFrom(one)
      if (original === null || within(path, original, root) === null) continue
      const way = this.covering(one)[0]?.way
      const key = relativeTo(root, one)
      if (way && !this.coveringAt(one).length && lockable(fitted(key))) came[key] = way
    }
    if (Object.keys(came).length) this.put(root, { ...this.ways(root), ...came })
  }

  moved(from: string, to: string, root: string | null, into: string | null = root): void {
    this.reread()
    if (root === null || from === to) return
    this.copiesKept(from, root)
    const move = moving(from, to, root, into)
    if (!move.was) return
    const above = this.covering(from).find((one) => one.key !== move.was)
    this.carry(move, root)
    if (above && move.now && !this.covering(to).length) {
      this.put(move.there, { ...this.ways(move.there), [move.now]: above.way })
    }
    const paper = paperMoving(from, to)
    if (paper) this.moved(paper[0], paper[1], root, into)
  }

  private carry(move: Moving, root: string): void {
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

  copied(from: string, to: string, root: string | null, into: string | null): void {
    this.reread()
    if (root === null || into === null) return
    this.insideCopiesKept(from, root)
    const was = relativeTo(root, from)
    const now = relativeTo(into, to)
    if (!lockable(fitted(now))) return
    const came: Record<string, Way> = {}
    for (const [key, way] of Object.entries(this.ways(root))) {
      const at = key === SPACE ? null : movedTo(key, was, now, root)
      if (at !== null) came[at] = way
    }
    const above = this.covering(from).find((one) => one.key !== was)
    if (!(now in came) && above && !this.covering(to).length) came[now] = above.way
    if (Object.keys(came).length) this.put(into, { ...this.ways(into), ...came })
    const paper = paperMoving(from, to)
    if (paper) this.copied(paper[0], paper[1], root, into)
  }

  async gone(path: string, root: string | null, back?: string): Promise<void> {
    if (root === null) return
    const burying = await buried()
    this.reread()
    this.copiesKept(path, root)
    const at = relativeTo(root, path)
    const went = (key: string) => key !== SPACE && within(at, key, root) !== null
    const above = this.covering(path).find((one) => one.key !== at)
    if (!Object.keys(this.ways(root)).some(went) && !above) return
    const held = { ...(above && { [at]: above.way }), ...this.ways(root) }
    const rehomed = burying.bury(root, at, back, held)
    this.put(
      root,
      Object.fromEntries(Object.entries(this.ways(root)).filter(([key]) => !went(key))),
    )
    await rehomed
  }

  cameBack(path: string, root: string | null, back: string): Promise<void> | undefined {
    return root === null ? undefined : this.unbury(back, root, relativeTo(root, path))
  }

  async unbury(back: string | null, root: string, at: string, was = at, only = false) {
    this.reread()
    const came = await (await buried()).unburied(back, root, at, this.ways(root), was, only)
    if (came) this.put(root, { ...this.ways(root), ...came })
  }

  spaceMoved(from: string, to: string): void {
    this.reread()
    const kept = this.spaces[from]
    if (!kept || from === to) return
    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
    void buried().then((one) => one.moveSpace(from, to))
  }

  async forget(root: string, back?: string): Promise<void> {
    const burying = await buried()
    this.reread()
    if (!(root in this.spaces)) return
    const rehomed = burying.bury(root, SPACE, back, this.ways(root))
    this.spaces = without(this.spaces, root)
    this.write()
    await rehomed
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
    this.keepSpaces()
  }

  private keepSpaces(): void {
    keepJson(STORAGE_KEY, this.spaces)
    this.heard = storedText(STORAGE_KEY)
  }
}

export function noteBehind(tab: {
  kind: string
  path: string | null
  behind?: string | null
}): string | null {
  return tab.kind === 'view' ? null : (tab.path ?? tab.behind ?? null)
}

export const protection = new Protection()
