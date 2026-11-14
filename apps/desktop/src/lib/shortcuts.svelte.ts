import { defaultKeyFor, type EditorView, type KeyOverrides, setShortcutKeys } from '@orden/editor'
import { account, api, type AccountSettings } from './accounts/src/api'
import {
  currentPlatform,
  type Keystroke,
  matchesCombination,
  parseCombination,
  sameCombination,
  showCombination,
  viewport,
} from './ui-kit/src/api'
import { modes } from './modes.svelte'
import { knownPreset, type PresetId } from './shortcuts/preset-ids'
import type { Preset } from './shortcuts/presets'
import { without, isRecord, keep, keepJson, stored, storedText, isNative } from './platform/src/api'
import {
  type AppContext,
  BROWSER_KEYS,
  BY_ID,
  DICTATION_TAPS,
  FIXED_ENTRIES,
  SHORTCUTS,
  type Shortcut,
  SYSTEM_KEYS,
} from './shortcuts/registry'
import { saveFront } from './save-place/door'
import { ran } from './usage/src/api'

export { CATEGORIES, type Category, SHORTCUTS, type Shortcut } from './shortcuts/registry'

const STORAGE_KEY = 'orden:shortcuts'

const WRITE_CHORD = 'Mod-s'
const PRESET_KEY = 'orden:preset'

const MOST_OVERRIDES = 200

const TYPING_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

class Shortcuts {
  overrides = $state<KeyOverrides>({})

  preset = $state<PresetId>('default')

  readonly platform = currentPlatform()

  restore() {
    this.overrides = usable(stored(STORAGE_KEY))
    this.preset =
      knownPreset(storedText(PRESET_KEY)) ??
      (Object.keys(this.overrides).length ? 'custom' : 'default')
  }

  choose(preset: Pick<Preset, 'id' | 'keys' | 'vim'>) {
    this.preset = preset.id
    this.overrides = { ...preset.keys }
    this.settle()
    modes.setVimKeys(preset.vim)
  }

  keyFor(id: string): string | null {
    const chosen = this.overrides[id]
    if (chosen !== undefined) return chosen

    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  defaultFor(id: string): string | null {
    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  changed(id: string): boolean {
    return id in this.overrides && this.overrides[id] !== this.defaultFor(id)
  }

  hint(id: string): string | undefined {
    const key = this.keyFor(id)
    return key ? showCombination(key, this.platform) : undefined
  }

  tooltip(label: string, id: string | null = null): string {
    const key = id !== null && !viewport.touch ? this.hint(id) : undefined
    return key ? `${label} (${key})` : label
  }

  conflicts(id: string, key: string): Shortcut[] {
    const entry = BY_ID.get(id)
    if (!key || entry?.contextual) return []

    return SHORTCUTS.filter((one) => {
      if (one.id === id || one.contextual || one.scope === 'fixed') return false

      const held = this.keyFor(one.id)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  fixedHolder(key: string): Shortcut | undefined {
    if (!key) return undefined

    return FIXED_ENTRIES.find((one) => {
      const held = defaultKeyFor(one, this.platform)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  warning(key: string | null): string | null {
    if (!key) return null

    const taken = (list: string[]) => list.some((one) => sameCombination(one, key, this.platform))
    if (taken(SYSTEM_KEYS[this.platform]))
      return 'Your system takes this key before the app sees it.'
    const said = key.trim().toLowerCase().split(/\s+/).join(' ')
    if (DICTATION_TAPS[this.platform].some((one) => one.toLowerCase() === said))
      return 'macOS can start dictation with this key too.'
    if (!isNative && taken(BROWSER_KEYS))
      return 'Your browser takes this key before the app sees it.'

    return null
  }

  refuse(key: string, row?: string): string | null {
    const combination = parseCombination(key, this.platform)
    if (!combination) return 'That is not a key combination.'
    if (combination.meta && this.platform !== 'mac') return 'That is not a key combination.'

    const bare = !combination.ctrl && !combination.meta && !combination.alt
    const typing = TYPING_KEYS.has(combination.key) && !this.inAList(row) && !this.ownKey(row, key)
    if (bare && (combination.key.length === 1 || typing)) {
      return this.platform === 'mac' ? 'Hold ⌃, ⌥ or ⌘ as well.' : 'Hold Ctrl or Alt as well.'
    }

    const fixed = this.fixedHolder(key)
    if (fixed && !this.inAList(row) && !this.ownKey(row, key)) {
      return `${showCombination(key, this.platform)} already runs ${fixed.label()}.`
    }

    return null
  }

  private ownKey(row: string | undefined, key: string): boolean {
    return row !== undefined && this.defaultFor(row) === key
  }

  private inAList(row: string | undefined): boolean {
    return SHORTCUTS.find((one) => one.id === row)?.scope === 'panel'
  }

  set(id: string, key: string | null) {
    if (Object.keys(this.overrides).length >= MOST_OVERRIDES && !(id in this.overrides)) return

    this.overrides = { ...this.overrides, [id]: key }
    this.preset = 'custom'
    this.settle()
  }

  reset(id: string) {
    this.overrides = without(this.overrides, id)
    this.preset = 'custom'
    this.settle()
  }

  resetAll() {
    this.choose({ id: 'default', keys: {}, vim: false })
  }

  private settle() {
    keepJson(STORAGE_KEY, this.overrides)
    keep(PRESET_KEY, this.preset)
    for (const view of this.views) setShortcutKeys(view, this.overrides)
    this.share()
  }

  private readonly views = new Set<EditorView>()

  apply(view: EditorView) {
    this.views.add(view)
    setShortcutKeys(view, this.overrides)
  }

  forget(view: EditorView) {
    this.views.delete(view)
  }

  get forEditor(): KeyOverrides {
    return this.overrides
  }

  receive(remote: AccountSettings) {
    const theirs = remote.shortcuts
    if (!theirs || typeof theirs !== 'object') {
      if (Object.keys(this.overrides).length || this.preset !== 'default') this.share()
      return
    }

    const usableOnes = usable(theirs)
    const named = knownPreset(remote.preset) ?? this.preset
    if (JSON.stringify(usableOnes) === JSON.stringify(this.overrides) && named === this.preset) {
      return
    }

    this.overrides = usableOnes
    this.preset = named
    keepJson(STORAGE_KEY, this.overrides)
    keep(PRESET_KEY, this.preset)
    for (const view of this.views) setShortcutKeys(view, this.overrides)
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    void api
      .saveSettings(token, { shortcuts: this.overrides, preset: this.preset })
      .catch(() => undefined)
  }

  pressed(id: string, event: Keystroke): boolean {
    const key = this.keyFor(id)
    return !!key && matchesCombination(key, event, this.platform)
  }

  handle(event: KeyboardEvent, context: AppContext): boolean {
    if (event.defaultPrevented) return false

    for (const entry of SHORTCUTS) {
      if (entry.scope !== 'app' || !entry.run || entry.shown?.() === false) continue

      const key = this.keyFor(entry.id)
      if (!key || !matchesCombination(key, event, this.platform)) continue

      event.preventDefault()
      ran(entry.id, 'shortcut')
      entry.run(context)
      return true
    }

    return false
  }

  get saveHint(): string {
    return showCombination(WRITE_CHORD, this.platform)
  }

  writeKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || !matchesCombination(WRITE_CHORD, event, this.platform)) {
      return false
    }

    event.preventDefault()
    saveFront()
    return true
  }
}

function usable(value: unknown): KeyOverrides {
  if (!isRecord(value)) return {}

  const kept: KeyOverrides = {}
  for (const [id, key] of Object.entries(value)) {
    if (key === null) kept[id] = null
    else if (typeof key === 'string' && key.length <= 40 && key.length > 0) kept[id] = key

    if (Object.keys(kept).length >= MOST_OVERRIDES) break
  }

  return kept
}

export const shortcuts = new Shortcuts()
