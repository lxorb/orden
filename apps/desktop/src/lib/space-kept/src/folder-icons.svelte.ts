import {
  insideItsSpace,
  movedTo,
  relativeTo,
  within,
  isRecord,
  isString,
  type Folded,
  type Folding,
  meet,
  spacesOf,
  Kept,
  without,
  withOrWithout,
} from '../../platform/src/api'
import { carried, type Moving, moving } from '../../file-ops/src/api'

export const STORAGE_KEY = 'orden:folder-icons'
export const MOST_FOLDER_ICONS = 400
const LONGEST_ICON = 2048
const LONGEST_TINT = 64
const SETTLING = 700
export function folderIconMap(value: unknown, longest = LONGEST_ICON): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [path, name] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_FOLDER_ICONS) break
    if (!insideItsSpace(path) || !isString(name)) continue
    const said = name.trim()
    if (said && said.length <= longest) out[path] = said
  }
  return out
}
interface Held extends Folded {
  icons: Record<string, string>
  colors: Record<string, string>
  sent: boolean
}
function read(saved: unknown): Record<string, Held> {
  return spacesOf(saved, (one) => ({
    icons: folderIconMap(one.icons),
    colors: folderIconMap(one.colors, LONGEST_TINT),
    sent: one.sent !== false,
  }))
}
function same(one: Record<string, string>, other: Record<string, string>): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}
const MAPS: Folding<Pick<Held, 'icons' | 'colors'>> = {
  fold: (theirs, mine) => ({
    icons: { ...theirs.icons, ...mine.icons },
    colors: { ...theirs.colors, ...mine.colors },
  }),
  same: (one, other) => same(one.icons, other.icons) && same(one.colors, other.colors),
}
export class FolderIcons {
  private keeping = new Kept(STORAGE_KEY, read)
  private get spaces(): Record<string, Held> {
    return this.keeping.value
  }
  private set spaces(value: Record<string, Held>) {
    this.keeping.value = value
  }
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}
  constructor(private readonly root: () => string | null) {}
  reread(): void {
    this.keeping.reread()
  }
  of(root: string): Record<string, string> {
    return this.spaces[root]?.icons ?? {}
  }
  private colorsOf(root: string): Record<string, string> {
    return this.spaces[root]?.colors ?? {}
  }
  iconOf(path: string, root = this.root()): string | null {
    if (root === null) return null
    return this.of(root)[relativeTo(root, path)] ?? null
  }
  tintOf(path: string, root = this.root()): string | null {
    if (root === null) return null
    return this.colorsOf(root)[relativeTo(root, path)] ?? null
  }
  set(path: string, name: string | null, tint: string | null = null) {
    const root = this.root()
    if (root === null) return
    const at = relativeTo(root, path)
    if (!insideItsSpace(at) || (name?.length ?? 0) > LONGEST_ICON || (tint?.length ?? 0) > LONGEST_TINT) return
    const held = this.of(root)
    const colour = name === null ? null : tint
    if ((held[at] ?? null) === name && (this.colorsOf(root)[at] ?? null) === colour) return
    if (name !== null && Object.keys(held).length >= MOST_FOLDER_ICONS && !(at in held)) return
    this.put(root, withOrWithout(held, at, name), withOrWithout(this.colorsOf(root), at, colour))
  }
  moved(from: string, to: string, root = this.root(), into: string | null = root) {
    if (root === null || from === to) return
    const move = moving(from, to, root, into)
    const { was } = move
    if (!was) return
    if (move.across) {
      this.carry(move)
      return
    }
    const now = move.now ?? ''
    const rekeyed = (held: Record<string, string>) => {
      const next: Record<string, string> = {}
      let touched = false
      for (const [path, name] of Object.entries(held)) {
        const moved = movedTo(path, was, now, root)
        next[moved ?? path] = name
        touched ||= moved !== null
      }
      return touched ? next : null
    }
    const icons = rekeyed(this.of(root))
    if (icons) this.put(root, icons, rekeyed(this.colorsOf(root)) ?? this.colorsOf(root))
  }
  private carry(move: Moving) {
    const across = (map: Record<string, string>) =>
      carried(
        Object.entries(map),
        move,
        ([path]) => path,
        ([, name], path): [string, string] => [path, name],
      )
    const icons = across(this.of(move.root))
    if (icons.left.length === Object.keys(this.of(move.root)).length) return
    const colors = across(this.colorsOf(move.root))
    this.put(move.root, Object.fromEntries(icons.left), Object.fromEntries(colors.left))
    if (!icons.went.length) return
    const held = { ...this.of(move.there) }
    for (const [path, name] of icons.went) {
      if (Object.keys(held).length >= MOST_FOLDER_ICONS && !(path in held)) break
      held[path] = name
    }
    const tints = { ...this.colorsOf(move.there) }
    for (const [path, colour] of colors.went) if (path in held) tints[path] = colour
    this.put(move.there, held, tints)
  }
  gone(path: string, root = this.root()) {
    if (root === null) return
    const at = relativeTo(root, path)
    if (!at) return
    const held = this.of(root)
    const kept = (map: Record<string, string>) =>
      Object.fromEntries(Object.entries(map).filter(([one]) => within(at, one, root) === null))
    const next = kept(held)
    if (Object.keys(next).length !== Object.keys(held).length) {
      this.put(root, next, kept(this.colorsOf(root)))
    }
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
  adopt(root: string, theirs: unknown, theirTints: unknown, accountId: string) {
    const icons = folderIconMap(theirs)
    const held = this.spaces[root]
    const mine = { icons: held?.icons ?? {}, colors: held?.colors ?? {} }
    const colors = theirTints === undefined ? mine.colors : folderIconMap(theirTints, LONGEST_TINT)
    const met = meet(held, accountId, mine, { icons, colors }, MAPS)
    if (!met) return
    this.spaces = { ...this.spaces, [root]: { ...met.value, account: accountId, sent: true } }
    this.write()
    if (met.tell) void this.push(root)
  }
  private put(root: string, icons: Record<string, string>, colors: Record<string, string>) {
    this.spaces = {
      ...this.spaces,
      [root]: { icons, colors, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.write()
    this.soon(root)
  }
  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)
    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      void this.push(root)
    }, SETTLING)
    this.pushing = { ...this.pushing, [root]: waiting }
  }
  private async push(root: string) {
    const { push } = await import('./pushing')
    const icons = this.of(root)
    const colors = this.colorsOf(root)
    await push(
      root,
      (api, token, spaceId) => api.saveFolderIcons(token, spaceId, icons, colors),
      (landed) => this.said(root, landed, icons, colors),
    )
  }
  private said(root: string, landed: boolean, icons: Record<string, string>, colors: Record<string, string>) {
    const held = this.spaces[root]
    if (!held || held.sent === landed) return
    if (landed && !(same(held.icons, icons) && same(held.colors, colors))) return
    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.write()
  }
  private write() {
    this.keeping.write()
  }
}
