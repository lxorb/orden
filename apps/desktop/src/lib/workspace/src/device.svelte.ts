import {
  forget,
  isBoolean,
  isNumber,
  isString,
  keep,
  Kept,
  recordOf,
  storedText,
  stringList,
  without,
  withOrWithout,
  movedTo,
  samePath,
  within,
  withinSpace,
} from '../../platform/src/api'
import type { FileOp } from '../../file-ops/src/api'

const RECENT_KEY = 'orden:recent'
const ICONS_KEY = 'orden:icons'
const ICON_TINTS_KEY = 'orden:icon-tints'
const EXPANDED_KEY = 'orden:expanded'
const LIST_AT_KEY = 'orden:list-at'
const TAGS_KEY = 'orden:expanded-tags'
const GROUPS_KEY = 'orden:expanded-groups'
const ESSENTIALS_KEY = 'orden:essentials-look'
const FOLLOWS_KEY = 'orden:pane-follows-pointer'
const RECENT_LIMIT = 15
const SETTLING = 400
const booleans = (saved: unknown) => recordOf(saved, isBoolean)
const strings = (saved: unknown) => recordOf(saved, isString)
export class DeviceView {
  private readonly kept = {
    recent: new Kept<string[]>(RECENT_KEY, (saved) => stringList(saved) ?? []),
    expanded: new Kept(EXPANDED_KEY, booleans),
    listScroll: new Kept(LIST_AT_KEY, (saved) => recordOf(saved, isNumber)),
    expandedTags: new Kept(TAGS_KEY, booleans),
    expandedGroups: new Kept(GROUPS_KEY, booleans),
    icons: new Kept(ICONS_KEY, strings),
    iconTints: new Kept(ICON_TINTS_KEY, strings),
  }
  paneFollowsPointer = $state(true)
  private writing: ReturnType<typeof setTimeout> | null = null
  constructor() {
    this.reread()
  }
  get recent(): string[] {
    return this.kept.recent.value
  }
  set recent(next: string[]) {
    this.kept.recent.value = next
  }
  get expanded(): Record<string, boolean> {
    return this.kept.expanded.value
  }
  set expanded(next: Record<string, boolean>) {
    this.kept.expanded.value = next
  }
  get listScroll(): Record<string, number> {
    return this.kept.listScroll.value
  }
  set listScroll(next: Record<string, number>) {
    this.kept.listScroll.value = next
  }
  get expandedTags(): Record<string, boolean> {
    return this.kept.expandedTags.value
  }
  set expandedTags(next: Record<string, boolean>) {
    this.kept.expandedTags.value = next
  }
  get expandedGroups(): Record<string, boolean> {
    return this.kept.expandedGroups.value
  }
  set expandedGroups(next: Record<string, boolean>) {
    this.kept.expandedGroups.value = next
  }
  get icons(): Record<string, string> {
    return this.kept.icons.value
  }
  get iconTints(): Record<string, string> {
    return this.kept.iconTints.value
  }
  reread(): void {
    for (const one of Object.values(this.kept)) one.reread()
    forget(ESSENTIALS_KEY)
    this.paneFollowsPointer = storedText(FOLLOWS_KEY) !== 'off'
  }
  remember(path: string) {
    this.recent = [path, ...this.recent.filter((entry) => !samePath(entry, path))].slice(0, RECENT_LIMIT)
    this.kept.recent.write()
    void import('../../matching/src/api').then((one) => one.frecency.use(`note:${path}`))
  }
  unremember(path: string) {
    this.recent = this.recent.filter((entry) => !samePath(entry, path))
    this.kept.recent.write()
  }
  isExpanded(path: string): boolean {
    return this.expanded[path] === true
  }
  toggleFolder(path: string) {
    this.expanded = this.isExpanded(path) ? without(this.expanded, path) : { ...this.expanded, [path]: true }
    this.kept.expanded.write()
  }
  isGroupOpen(id: string): boolean {
    return this.expandedGroups[id] === true
  }
  toggleGroup(id: string) {
    this.expandedGroups = this.isGroupOpen(id)
      ? without(this.expandedGroups, id)
      : { ...this.expandedGroups, [id]: true }
    this.kept.expandedGroups.write()
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
      this.kept.listScroll.write()
    }, SETTLING)
  }
  follow(op: FileOp) {
    this.forget(op)
    if (op.op !== 'moved') return
    if (op.kind === 'space') {
      this.moveIcon(op.from, op.to)
      const at = this.listScroll[op.from]
      if (at !== undefined) {
        this.listScroll = { ...without(this.listScroll, op.from), [op.to]: at }
        this.kept.listScroll.write()
      }
    }
    const moved = (path: string) => movedTo(path, op.from, op.to) ?? path
    const recent = this.recent.map(moved)
    if (recent.some((one, at) => one !== this.recent[at])) {
      this.recent = recent
      this.kept.recent.write()
    }
    const open = Object.keys(this.expanded)
    if (open.some((path) => moved(path) !== path)) {
      this.expanded = Object.fromEntries(open.map((path) => [moved(path), true]))
      this.kept.expanded.write()
    }
  }
  private forget(op: FileOp) {
    if (op.op !== 'removed') return
    const kept = Object.keys(this.expanded).filter((path) => within(op.path, path) === null)
    if (kept.length === Object.keys(this.expanded).length) return
    this.expanded = Object.fromEntries(kept.map((path) => [path, true]))
    this.kept.expanded.write()
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
    this.kept.expanded.write()
  }
  isTagOpen(path: string): boolean {
    return this.expandedTags[path] === true
  }
  toggleTag(path: string) {
    this.expandedTags = this.isTagOpen(path) ? without(this.expandedTags, path) : { ...this.expandedTags, [path]: true }
    this.kept.expandedTags.write()
  }
  expand(path: string) {
    if (this.isExpanded(path)) return
    this.toggleFolder(path)
  }
  foldUnder(root: string) {
    const kept = Object.fromEntries(Object.entries(this.expanded).filter(([path]) => withinSpace(root, path) === null))
    if (Object.keys(kept).length === Object.keys(this.expanded).length) return
    this.expanded = kept
    this.kept.expanded.write()
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
    this.kept.icons.value = next
    this.kept.icons.write()
  }
  private writeTints(next: Record<string, string>) {
    this.kept.iconTints.value = next
    this.kept.iconTints.write()
  }
}
