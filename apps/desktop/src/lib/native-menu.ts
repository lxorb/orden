import { tapOf } from './double-tap'
import { matchesCombination, PHYSICAL, parseCombination } from './keys'
import { DIVIDER, isSubmenu, type MenuGroup, type MenuItem, type MenuRow } from './menu-item'
import { ran } from './usage/tally'

type SystemItem =
  | 'About'
  | 'Services'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Quit'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'Minimize'
  | 'Maximize'
  | 'BringAllToFront'

export type StandIn = 'undo' | 'redo' | 'selectAll'

export interface NativeItem {
  kind: 'item'
  id: string
  text: string
  accelerator: string | null
  enabled: boolean
  checked?: boolean
  key: string | null
  anywhere: boolean
  standIn?: StandIn
}

export interface NativeSubmenu {
  kind: 'submenu'
  id: string
  text: string
  enabled: boolean
  items: NativeEntry[]
  role?: 'window' | 'help'
}

interface NativeSystem {
  kind: 'system'
  id: string
  item: SystemItem
  text: string
}

interface NativeRule {
  kind: 'rule'
  id: string
}

export type NativeEntry = NativeItem | NativeSubmenu | NativeSystem | NativeRule

export interface MenuBarWords {
  app: string
  about: string
  services: string
  hide: string
  hideOthers: string
  showAll: string
  quit: string
  window: string
  minimize: string
  zoom: string
  bringAllToFront: string
  find: string
}

export interface MenuBarSources {
  groups: MenuGroup[]
  file: { opening: MenuRow[]; closing: MenuRow[] }
  settings: MenuItem | null
  windowRows: MenuItem[]
  helpRows: MenuItem[]
  viewRows: MenuItem[]
  keyFor(command: string): string | null
  isWindowCommand(command: string): boolean
  words: MenuBarWords
  english: boolean
}

export interface MenuBar {
  entries: NativeEntry[]
  runs: Map<string, () => void>
}

const SYSTEM_COMMANDS: Record<string, SystemItem> = {
  'fixed.cut': 'Cut',
  'fixed.copy': 'Copy',
  'fixed.paste': 'Paste',
}

const STAND_INS: Record<string, StandIn> = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.select-all': 'selectAll',
}

const SYSTEM_ACCELERATORS = ['Cmd+Q', 'Cmd+H', 'Cmd+Alt+H', 'Cmd+M', 'Cmd+X', 'Cmd+C', 'Cmd+V']

const NAMED_KEYS: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  ' ': 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

const PUNCTUATION = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`'])

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/

function acceleratorKey(key: string): string | null {
  if (/^[a-z]$/.test(key)) return key.toUpperCase()
  if (/^\d$/.test(key) || PUNCTUATION.has(key) || FUNCTION_KEY.test(key)) return key

  return NAMED_KEYS[key] ?? null
}

export function toAccelerator(key: string): string | null {
  const combination = parseCombination(key, 'mac')
  if (!combination) return null

  const named = acceleratorKey(combination.key)
  if (!named) return null

  const chord = combination.meta || combination.ctrl || combination.alt
  if (!chord && !FUNCTION_KEY.test(named)) return null

  const parts: string[] = []
  if (combination.meta) parts.push('Cmd')
  if (combination.ctrl) parts.push('Ctrl')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')
  parts.push(named)

  return parts.join('+')
}

const LET_PASS_WITHIN = 1000

export interface SeenKey {
  event: {
    key: string
    code?: string | undefined
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    defaultPrevented: boolean
  }
  at: number
}

export function documentWindows(labels: string[]): number {
  return labels.filter((label) => label === 'main' || /^orden-\d+$/.test(label)).length
}

export type KeyboardAt = 'note' | 'page' | 'away'

export function keyRuns(anywhere: boolean, at: KeyboardAt): boolean {
  return anywhere || at === 'note'
}

export interface Keypress {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function keystrokeOf(text: string): Keypress | null {
  const combination = parseCombination(text, 'mac')
  if (!combination) return null

  const { key } = combination
  const code =
    Object.keys(PHYSICAL).find((one) => PHYSICAL[one] === key) ?? (key === ' ' ? 'Space' : key)

  return {
    key,
    code,
    ctrlKey: combination.ctrl,
    metaKey: combination.meta,
    altKey: combination.alt,
    shiftKey: combination.shift,
  }
}

export function letPass(key: string, seen: SeenKey | null, now: number): boolean {
  if (!seen || now - seen.at > LET_PASS_WITHIN) return false
  if (seen.event.defaultPrevented) return false

  return matchesCombination(key, seen.event, 'mac')
}

export function leftFullscreen(was: boolean, now: boolean, appOn: boolean): boolean {
  return was && !now && appOn
}

const FINDING = ['edit.find', 'edit.replace', 'edit.find-next', 'edit.find-previous']

const SMALL = new Set(
  'a an the and but for nor or so yet as at by from in into of off on onto out per to up via with'.split(
    ' ',
  ),
)

export function titled(text: string): string {
  const words = text.split(' ')
  return words
    .map((word, index) => {
      const edge = index === 0 || index === words.length - 1
      return word
        .split('-')
        .map((part) => {
          if (!/^[a-z]+$/.test(part)) return part
          if (!edge && SMALL.has(part)) return part
          return part.charAt(0).toUpperCase() + part.slice(1)
        })
        .join('-')
    })
    .join(' ')
}

function tidy(rows: MenuRow[]): MenuRow[] {
  const out: MenuRow[] = []
  for (const row of rows) {
    if (row === DIVIDER && (out.length === 0 || out.at(-1) === DIVIDER)) continue
    out.push(row)
  }
  while (out.at(-1) === DIVIDER) out.pop()

  return out
}

function claimer(): (accelerator: string | null) => string | null {
  const taken = new Set(SYSTEM_ACCELERATORS)

  return (accelerator) => {
    if (!accelerator || taken.has(accelerator)) return null

    taken.add(accelerator)
    return accelerator
  }
}

export function chordFor(
  keyFor: (command: string) => string | null,
  command: string,
): string | null {
  const key = keyFor(command)
  if (!key || !tapOf(key, 'mac')) return key

  const second = keyFor(`${command}.alt`)
  return second && !tapOf(second, 'mac') ? second : null
}

export function describeMenuBar(sources: MenuBarSources): MenuBar {
  const { groups, words } = sources
  const runs = new Map<string, () => void>()
  const claim = claimer()
  const say = (text: string) => (sources.english ? titled(text) : text)

  const item = (row: MenuItem, id: string): NativeItem => {
    const key = row.command ? chordFor((one) => sources.keyFor(one), row.command) : null
    const accelerator = claim(key ? toAccelerator(key) : null)
    const standIn = row.command ? STAND_INS[row.command] : undefined
    runs.set(id, () => {
      ran(row.command, 'menu')
      row.run()
    })

    return {
      kind: 'item',
      id,
      text: say(row.label) + (row.asks ? '…' : ''),
      accelerator,
      enabled: standIn !== undefined || !row.disabled,
      ...(row.checked === undefined ? {} : { checked: row.checked }),
      key: accelerator ? key : null,
      anywhere: standIn !== undefined || !row.command || sources.isWindowCommand(row.command),
      ...(standIn ? { standIn } : {}),
    }
  }

  const entries = (rows: MenuRow[], parent: string): NativeEntry[] =>
    tidy(rows).map((row, index): NativeEntry => {
      const id = `${parent}.${index}`
      if (row === DIVIDER) return { kind: 'rule', id }
      if (isSubmenu(row)) {
        return {
          kind: 'submenu',
          id,
          text: say(row.label),
          enabled: !row.disabled,
          items: entries(row.rows, id),
        }
      }

      const system = row.command ? SYSTEM_COMMANDS[row.command] : undefined
      if (system) return { kind: 'system', id, item: system, text: say(row.label) }

      return item(row, id)
    })

  const { settings } = sources

  const app: NativeSubmenu = {
    kind: 'submenu',
    id: 'orden',
    text: words.app,
    enabled: true,
    items: [
      { kind: 'system', id: 'orden.about', item: 'About', text: say(words.about) },
      { kind: 'rule', id: 'orden.rule-1' },
      ...(settings ? [item({ ...settings, asks: true }, 'orden.settings')] : []),
      { kind: 'rule', id: 'orden.rule-2' },
      { kind: 'system', id: 'orden.services', item: 'Services', text: say(words.services) },
      { kind: 'rule', id: 'orden.rule-3' },
      { kind: 'system', id: 'orden.hide', item: 'Hide', text: say(words.hide) },
      { kind: 'system', id: 'orden.hide-others', item: 'HideOthers', text: say(words.hideOthers) },
      { kind: 'system', id: 'orden.show-all', item: 'ShowAll', text: say(words.showAll) },
      { kind: 'rule', id: 'orden.rule-4' },
      { kind: 'system', id: 'orden.quit', item: 'Quit', text: say(words.quit) },
    ],
  }

  const fileRows = (rows: MenuRow[]): MenuRow[] => [
    ...sources.file.opening,
    DIVIDER,
    ...rows,
    DIVIDER,
    ...sources.file.closing,
  ]

  const editRows = (rows: MenuRow[]): MenuRow[] => {
    const finding = rows.filter(
      (row): row is MenuItem =>
        row !== DIVIDER && !isSubmenu(row) && FINDING.includes(row.command ?? ''),
    )
    const first = finding[0]
    if (!first) return rows

    const rest = rows.filter((row) => !finding.includes(row as MenuItem))
    rest.splice(rows.indexOf(first), 0, { label: words.find, rows: finding })
    return rest
  }

  const rowsOf = (group: MenuGroup): MenuRow[] => {
    if (group.id === 'file') return fileRows(group.rows)
    if (group.id === 'edit') return editRows(group.rows)
    if (group.id === 'help' && sources.helpRows.length) {
      return [...sources.helpRows, DIVIDER, ...group.rows]
    }
    if (group.id === 'view' && sources.viewRows.length) {
      return [...group.rows, DIVIDER, ...sources.viewRows]
    }

    return group.rows
  }

  const own = groups.map((group): NativeSubmenu => ({
    kind: 'submenu',
    id: group.id,
    text: say(group.label),
    enabled: true,
    items: entries(rowsOf(group), group.id),
    ...(group.id === 'help' ? { role: 'help' as const } : {}),
  }))

  const window: NativeSubmenu = {
    kind: 'submenu',
    id: 'window',
    text: say(words.window),
    enabled: true,
    role: 'window',
    items: [
      { kind: 'system', id: 'window.minimize', item: 'Minimize', text: say(words.minimize) },
      { kind: 'system', id: 'window.zoom', item: 'Maximize', text: say(words.zoom) },
      ...(sources.windowRows.length ? [{ kind: 'rule' as const, id: 'window.rule-1' }] : []),
      ...sources.windowRows.map((row, index) => item(row, `window.tab-${index}`)),
      { kind: 'rule', id: 'window.rule-2' },
      {
        kind: 'system',
        id: 'window.front',
        item: 'BringAllToFront',
        text: say(words.bringAllToFront),
      },
    ],
  }

  const help = own.findIndex((one) => one.id === 'help')
  const at = help < 0 ? own.length : help

  return { entries: [app, ...own.slice(0, at), window, ...own.slice(at)], runs }
}

export interface Change {
  id: string
  text?: string
  enabled?: boolean
  checked?: boolean
  accelerator?: string | null
}

export function flatten(entries: NativeEntry[]): NativeEntry[] {
  return entries.flatMap((one) => (one.kind === 'submenu' ? [one, ...flatten(one.items)] : [one]))
}

function shapeOf(entry: NativeEntry): string {
  if (entry.kind === 'system') return `${entry.id} system ${entry.item}`
  if (entry.kind === 'item') return `${entry.id} ${entry.checked === undefined ? 'item' : 'check'}`
  if (entry.kind === 'submenu') return `${entry.id} submenu ${entry.items.length}`

  return `${entry.id} rule`
}

export function changesBetween(before: NativeEntry[], after: NativeEntry[]): Change[] | null {
  const was = flatten(before)
  const now = flatten(after)
  if (was.length !== now.length) return null

  const changes: Change[] = []
  for (const [index, next] of now.entries()) {
    const previous = was[index]
    if (!previous || shapeOf(previous) !== shapeOf(next)) return null

    const change: Change = { id: next.id }
    if (previous.kind !== 'rule' && next.kind !== 'rule' && previous.text !== next.text) {
      change.text = next.text
    }
    if (previous.kind === 'item' && next.kind === 'item') {
      if (previous.enabled !== next.enabled) change.enabled = next.enabled
      if (previous.checked !== next.checked && next.checked !== undefined) {
        change.checked = next.checked
      }
      if (previous.accelerator !== next.accelerator) change.accelerator = next.accelerator
    }
    if (
      previous.kind === 'submenu' &&
      next.kind === 'submenu' &&
      previous.enabled !== next.enabled
    ) {
      change.enabled = next.enabled
    }

    if (Object.keys(change).length > 1) changes.push(change)
  }

  return changes
}
