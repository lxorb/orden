import {
  forget,
  isBoolean,
  isNumber,
  isString,
  keep,
  keepJson,
  recordOf,
  stored,
  storedText,
  stringList,
  without,
  withOrWithout,
  movedTo,
  samePath,
  within,
  withinSpace,
} from '../platform/src/api'
import type { FileOp } from './file-ops'

export const RECENT_KEY = 'orden:recent'
export const ICONS_KEY = 'orden:icons'
export const ICON_TINTS_KEY = 'orden:icon-tints'
export const EXPANDED_KEY = 'orden:expanded'
const LIST_AT_KEY = 'orden:list-at'
export const TAGS_KEY = 'orden:expanded-tags'
const GROUPS_KEY = 'orden:expanded-groups'
const ESSENTIALS_KEY = 'orden:essentials-look'
const FOLLOWS_KEY = 'orden:pane-follows-pointer'

const RECENT_LIMIT = 15

const SETTLING = 400

export class DeviceView {
  recent = $state<string[]>([])

  expanded = $state<Record<string, boolean>>({})

  listScroll = $state<Record<string, number>>({})

  expandedTags = $state<Record<string, boolean>>({})
  expandedGroups = $state<Record<string, boolean>>({})
  paneFollowsPointer = $state(true)

  icons = $state<Record<string, string>>({})

  iconTints = $state<Record<string, string>>({})

  private writing: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.reread()
  }

  reread(): void {
    this.recent = stringList(stored(RECENT_KEY)) ?? []
    this.expanded = recordOf(stored(EXPANDED_KEY), isBoolean)
    this.listScroll = recordOf(stored(LIST_AT_KEY), isNumber)
    this.expandedTags = recordOf(stored(TAGS_KEY), isBoolean)
    this.expandedGroups = recordOf(stored(GROUPS_KEY), isBoolean)
    forget(ESSENTIALS_KEY)
    this.paneFollowsPointer = storedText(FOLLOWS_KEY) !== 'off'
    this.icons = recordOf(stored(ICONS_KEY), isString)
    this.iconTints = recordOf(stored(ICON_TINTS_KEY), isString)
  }

  remember(path: string) {
    this.recent = [path, ...this.recent.filter((entry) => !samePath(entry, path))].slice(
      0,
      RECENT_LIMIT,
    )
    keepJson(RECENT_KEY, this.recent)
    void import('../frecency').then((one) => one.frecency.use(`note:${path}`))
  }

  unremember(path: string) {
    this.recent = this.recent.filter((entry) => !samePath(entry, path))
    keepJson(RECENT_KEY, this.recent)
  }

  isExpanded(path: string): boolean {
    return this.expanded[path] === true
  }

  toggleFolder(path: string) {
    this.expanded = this.isExpanded(path)
      ? without(this.expanded, path)
      : { ...this.expanded, [path]: true }

    keepJson(EXPANDED_KEY, this.expanded)
  }

  isGroupOpen(id: string): boolean {
    return this.expandedGroups[id] === true
  }

  toggleGroup(id: string) {
    this.expandedGroups = this.isGroupOpen(id)
      ? without(this.expandedGroups, id)
      : { ...this.expandedGroups, [id]: true }
    keepJson(GROUPS_KEY, this.expandedGroups)
  }

  followPointer(on: boolean) {
    this.paneFollowsPointer = on
    keep(FOLLOWS_KEY, on ? 'on' : 'off')
  }

  listAt(root: string): number {
    return this.listScroll[root] ?? 0
  }

  setListAt(root: string, at: number) {
    const round = Math.max(0, Math.round(at))
    if (this.listScroll[root] === round) return

    this.listScroll = { ...this.listScroll, [root]: round }
    if (this.writing !== null) return

    this.writing = setTimeout(() => {
      this.writing = null
      keepJson(LIST_AT_KEY, this.listScroll)
    }, SETTLING)
  }

  follow(op: FileOp) {
    this.forget(op)
    if (op.op !== 'moved') return

    if (op.kind === 'space') {
      this.moveIcon(op.from, op.to)
      const at = this.listScroll[op.from]
      if (at !== undefined) this.listScroll = { ...without(this.listScroll, op.from), [op.to]: at }
    }

    const moved = (path: string) => movedTo(path, op.from, op.to) ?? path
    const recent = this.recent.map(moved)
    if (recent.some((one, at) => one !== this.recent[at])) {
      this.recent = recent
      keepJson(RECENT_KEY, recent)
    }

    const open = Object.keys(this.expanded)
    if (open.some((path) => moved(path) !== path)) {
      this.expanded = Object.fromEntries(open.map((path) => [moved(path), true]))
      keepJson(EXPANDED_KEY, this.expanded)
    }
  }

  private forget(op: FileOp) {
    if (op.op !== 'removed') return

    const kept = Object.keys(this.expanded).filter((path) => within(op.path, path) === null)
    if (kept.length === Object.keys(this.expanded).length) return

    this.expanded = Object.fromEntries(kept.map((path) => [path, true]))
    keepJson(EXPANDED_KEY, this.expanded)
  }

  keepOpen(root: string, spelled: (path: string) => string | null) {
    const open = Object.keys(this.expanded)
    const now = open.flatMap((path) => {
      if (withinSpace(root, path) === null) return [path]
      const listed = spelled(path)
      return listed === null ? [] : [listed]
    })
    if (now.length === open.length && now.every((path, at) => path === open[at])) return

    this.expanded = Object.fromEntries(now.map((path) => [path, true]))
    keepJson(EXPANDED_KEY, this.expanded)
  }

  isTagOpen(path: string): boolean {
    return this.expandedTags[path] === true
  }

  toggleTag(path: string) {
    this.expandedTags = this.isTagOpen(path)
      ? without(this.expandedTags, path)
      : { ...this.expandedTags, [path]: true }

    keepJson(TAGS_KEY, this.expandedTags)
  }

  expand(path: string) {
    if (this.isExpanded(path)) return
    this.toggleFolder(path)
  }

  foldUnder(root: string) {
    const kept = Object.fromEntries(
      Object.entries(this.expanded).filter(([path]) => withinSpace(root, path) === null),
    )
    if (Object.keys(kept).length === Object.keys(this.expanded).length) return

    this.expanded = kept
    keepJson(EXPANDED_KEY, this.expanded)
  }

  iconOf(root: string): string | null {
    return this.icons[root] ?? null
  }

  tintOf(root: string): string | null {
    return this.iconTints[root] ?? null
  }

  setIcon(root: string, name: string | null, tint: string | null = null) {
    this.writeIcons(withOrWithout(this.icons, root, name))
    this.writeTints(withOrWithout(this.iconTints, root, name === null ? null : tint))
  }

  applyIcon(root: string, name: string | null, tint?: string | null): string | null {
    const mine = this.tintOf(root)
    const said = tint !== undefined
    const colour = said ? tint : mine
    const unsaid = said || name === null ? null : mine

    if (this.iconOf(root) !== name || mine !== colour) this.setIcon(root, name, colour)

    return unsaid
  }

  private moveIcon(from: string, to: string) {
    const icon = this.icons[from]
    if (!icon || from === to) return

    this.writeIcons({ ...without(this.icons, from), [to]: icon })

    const tint = this.iconTints[from]
    if (tint) this.writeTints({ ...without(this.iconTints, from), [to]: tint })
  }

  private writeIcons(next: Record<string, string>) {
    this.icons = next
    keepJson(ICONS_KEY, next)
  }

  private writeTints(next: Record<string, string>) {
    this.iconTints = next
    keepJson(ICON_TINTS_KEY, next)
  }
}
