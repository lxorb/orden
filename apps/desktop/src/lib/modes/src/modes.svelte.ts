import {
  modeEffects,
  type ModeSettings,
  setCloseBrackets,
  setCodeLineNumbers,
  setCodeTheme,
  setFocusMode,
  setHeadingNumbers,
  setLineHeight,
  setMeasure,
  setQuietMarks,
  setReadOnlyMode,
  setRightToLeft,
  setEquationNumbers,
  setSmartPunctuation,
  remeasure,
  setSourceMode,
  setSpellcheck,
  setHighlightColour,
  setStrictMode,
  setTypewriterMode,
  setVim,
  onVimMode,
  type VimMode,
  type EditorView,
} from '@orden/editor'
import { setHardBreaks } from '@orden/markdown/breaks'
import { highlightTone, type HighlightColour } from '@orden/markdown/highlights'
import { SvelteMap } from 'svelte/reactivity'
import { AccountOwed, api, type AccountSettings } from '../../accounts/src/api'
import { viewport } from '../../ui-kit/src/api'
import { type AttachmentFolder, isAttachmentFolder } from './attachments'
import { isPaper, type Paper } from '@orden/markdown/papers'
import { isLinkFormat, type LinkFormat, setLinkWriting } from '../../link-format/src/api'
import { type ConflictRule, conflictRule, DEFAULT_RULE } from '../../sync-mirror/src/api'
import {
  isNumber,
  isRecord,
  isString,
  heardElsewhere,
  keepJson,
  stored,
  stringList,
  currentWindow,
  invoke,
  isDesktop,
} from '../../platform/src/api'
import { opening } from '../../documents/src/api'

const STORAGE_KEY = 'orden:modes'
const STALE = [
  'ligatures',
  'spellLanguage',
  'spellWords',
  'overviewBlur',
  'flushBottom',
  'glassesScroll',
  'glassesBreak',
  'glassesLineNumbers',
  'glassesVoice',
  'glassesCompaction',
  'glassesMarks',
  'glassesWords',
  'glassesSeen',
  'translucent',
  'properties',
  'frontMatter',
  'frontMatterDrawn',
  'canvasTurns',
  'undatedToday',
  'undatedInToday',
]
const OWED_KEY = 'orden:modes-owed'
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]
export const INTERFACE_ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const KEEP_MONTH = 30
export const KEEP_YEAR = 365
export const KEEP_VERSIONS: readonly number[] = [KEEP_MONTH, KEEP_YEAR]
export const REMIND_BEFORE: readonly number[] = [0, 5, 15, 30, 60, -1]
const ROLLBACK_STEPS: readonly number[] = [1, 7, 30, 90, 180, 365]
export function rollbackSteps(keep: number): number[] {
  return ROLLBACK_STEPS.filter((one) => one <= keep)
}
export const WIDTHS = [32, 38, 42, 50, 60, 80] as const
export const LINE_HEIGHTS = [1.5, 1.62, 1.72, 1.85, 2] as const
export const FRAMES = ['orden', 'system'] as const
export type Frame = (typeof FRAMES)[number]
export function frameChoice(value: unknown): Frame | null {
  if (value === 'nib') return 'orden'
  return FRAMES.find((one) => one === value) ?? null
}
interface Saved {
  source: boolean
  readOnly: boolean
  focus: boolean
  quietMarks: boolean
  silent: boolean
  developer?: boolean
  typewriter: boolean
  punctuation: boolean
  numbers: boolean
  lineNumbers: boolean
  codeTheme: string
  rtl: boolean
  strict: boolean
  equationNumbers: boolean
  zoom: number
  width: number
  lineHeight: number
  spellcheck: boolean
  spellLanguages: string[]
  alwaysOnTop: boolean
  frame: Frame
  hand: boolean
  fonts: Record<FontPlace, string>
  closeBrackets: boolean
  mobileSeen: boolean
  vim: boolean
  attachments: string
  pagesPaper: string
  conflicts: string
  keepVersions: number
  remindBefore: number
  turnsCanvas: boolean
  canvasTurnSnaps: boolean
  highlightTone: number | null
  hardBreaks: boolean
  linkFormat: LinkFormat
}
export const VIM_WORDS: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  replace: 'REPLACE',
}
function clamp(value: number, steps: readonly number[]): number {
  return steps.reduce((best, one) => (Math.abs(one - value) < Math.abs(best - value) ? one : best))
}
function step(steps: readonly number[], current: number, direction: number, fallback: number) {
  if (!Number.isFinite(current)) return fallback
  if (direction > 0) return steps.find((one) => one > current) ?? current
  if (direction < 0) return [...steps].reverse().find((one) => one < current) ?? current
  return current
}
export type FontPlace = 'ui' | 'content' | 'mono'
export const FONT_PLACES: readonly FontPlace[] = ['ui', 'content', 'mono']
export function familyName(value: unknown): string {
  if (!isString(value)) return ''
  const name = value.trim().replace(/\s+/g, ' ')
  return /^[\p{L}\p{N}][\p{L}\p{N} ._&+-]{0,63}$/u.test(name) ? name : ''
}
function text(value: unknown, fallback: string): string {
  return isString(value) && value ? value : fallback
}
function measure(value: unknown, fallback: number): number {
  return isNumber(value) && value !== 0 ? value : fallback
}
export const DEFAULTS = {
  opensInSource: false,
  readOnly: false,
  focus: false,
  quietMarks: false,
  silent: false,
  typewriter: false,
  punctuation: false,
  numbers: false,
  lineNumbers: false,
  codeTheme: 'follow',
  rtl: false,
  strict: false,
  equationNumbers: false,
  zoom: 1,
  width: 42,
  lineHeight: 1.72,
  spellcheck: true,
  spellLanguages: [] as string[],
  alwaysOnTop: false,
  frame: 'orden' as Frame,
  hand: false,
  fonts: { ui: '', content: '', mono: '' } as Record<FontPlace, string>,
  closeBrackets: true,
  mobileSeen: false,
  vim: false,
  attachments: 'space' as AttachmentFolder,
  pagesPaper: 'a4' as Paper,
  conflicts: DEFAULT_RULE,
  keepVersions: KEEP_MONTH,
  remindBefore: 0,
  canvasTurns: true,
  canvasTurnSnaps: true,
  highlightTone: null as number | null,
  hardBreaks: false,
  linkFormat: 'wikilink' as LinkFormat,
}
function on(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function keepingOf(value: unknown): number | undefined {
  return isNumber(value) && KEEP_VERSIONS.includes(value) ? value : undefined
}
function remindingOf(value: unknown): number | undefined {
  return isNumber(value) && REMIND_BEFORE.includes(value) ? value : undefined
}
function toneOf(value: unknown): number | null | undefined {
  return isNumber(value) || value === null ? highlightTone(value).tone : undefined
}
function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
interface Follow<T> {
  read(value: unknown): T | undefined
  start: T
  then?(value: T): void
}
type Synced = { [K in keyof Modes]?: Follow<Modes[K]> }
interface Shown {
  tab: { source: boolean }
  kept: () => void
}
class Modes {
  opensInSource = $state(DEFAULTS.opensInSource)
  readOnly = $state(DEFAULTS.readOnly)
  focus = $state(DEFAULTS.focus)
  quietMarks = $state(DEFAULTS.quietMarks)
  silent = $state(DEFAULTS.silent)
  developer = $state<boolean | null>(null)
  typewriter = $state(DEFAULTS.typewriter)
  punctuation = $state(DEFAULTS.punctuation)
  numbers = $state(DEFAULTS.numbers)
  lineNumbers = $state(DEFAULTS.lineNumbers)
  codeTheme = $state(DEFAULTS.codeTheme)
  rtl = $state(DEFAULTS.rtl)
  strict = $state(DEFAULTS.strict)
  equationNumbers = $state(DEFAULTS.equationNumbers)
  zoom = $state(DEFAULTS.zoom)
  interfaceZoom = $state(1)
  width = $state(DEFAULTS.width)
  lineHeight = $state(DEFAULTS.lineHeight)
  spellcheck = $state(DEFAULTS.spellcheck)
  spellLanguages = $state<string[]>([])
  alwaysOnTop = $state(DEFAULTS.alwaysOnTop)
  frame = $state<Frame>(DEFAULTS.frame)
  hand = $state(DEFAULTS.hand)
  fonts = $state<Record<FontPlace, string>>({ ...DEFAULTS.fonts })
  closeBrackets = $state(DEFAULTS.closeBrackets)
  mobileSeen = $state(DEFAULTS.mobileSeen)
  vim = $state(DEFAULTS.vim)
  readonly vimModes = new SvelteMap<EditorView, VimMode>()
  attachments = $state<AttachmentFolder>(DEFAULTS.attachments)
  pagesPaper = $state<Paper>(DEFAULTS.pagesPaper)
  conflicts = $state<ConflictRule>(DEFAULTS.conflicts)
  keepVersions = $state<number>(DEFAULTS.keepVersions)
  remindBefore = $state<number>(DEFAULTS.remindBefore)
  canvasTurns = $state(DEFAULTS.canvasTurns)
  canvasTurnSnaps = $state(DEFAULTS.canvasTurnSnaps)
  highlightTone = $state<number | null>(DEFAULTS.highlightTone)
  hardBreaks = $state(DEFAULTS.hardBreaks)
  linkFormat = $state<LinkFormat>(DEFAULTS.linkFormat)
  constructor() {
    onVimMode((view, mode) => {
      if (mode) this.vimModes.set(view, mode)
      else this.vimModes.delete(view)
    })
    heardElsewhere([STORAGE_KEY], () => {
      this.restore()
      this.applyAlwaysOnTop()
    })
  }
  restore() {
    const saved = stored(STORAGE_KEY)
    const stale = isRecord(saved) && STALE.some((name) => name in saved)
    if (isRecord(saved)) {
      this.opensInSource = on(saved.source, DEFAULTS.opensInSource)
      opening.source = this.opensInSource
      for (const [name, start] of Object.entries(DEFAULTS)) {
        if (typeof start === 'boolean' && name !== 'opensInSource') {
          Object.assign(this, { [name]: on(saved[name], start) })
        }
      }
      if (saved.reading === true) this.readOnly = true
      this.developer = typeof saved.developer === 'boolean' ? saved.developer : null
      this.codeTheme = text(saved.codeTheme, DEFAULTS.codeTheme)
      this.zoom = measure(saved.zoom, DEFAULTS.zoom)
      this.width = measure(saved.width, DEFAULTS.width)
      this.lineHeight = measure(saved.lineHeight, DEFAULTS.lineHeight)
      this.spellLanguages =
        stringList(saved.spellLanguages) ??
        (isString(saved.spellLanguage) && saved.spellLanguage !== 'system' ? [saved.spellLanguage] : [])
      this.conflicts = conflictRule(saved.conflicts) ?? DEFAULTS.conflicts
      this.keepVersions = keepingOf(saved.keepVersions) ?? DEFAULTS.keepVersions
      this.remindBefore = remindingOf(saved.remindBefore) ?? this.remindBefore
      this.frame = frameChoice(saved.frame) ?? DEFAULTS.frame
      if (isAttachmentFolder(saved.attachments)) this.attachments = saved.attachments
      if (isPaper(saved.pagesPaper)) this.pagesPaper = saved.pagesPaper
      const tone = toneOf(saved.highlightTone)
      if (tone !== undefined) this.highlightTone = tone
      if (isLinkFormat(saved.linkFormat)) this.linkFormat = saved.linkFormat
      const fonts = isRecord(saved.fonts) ? saved.fonts : {}
      this.fonts = {
        ui: familyName(fonts.ui),
        content: familyName(fonts.content),
        mono: familyName(fonts.mono),
      }
      this.canvasTurns = on(saved.turnsCanvas, DEFAULTS.canvasTurns)
    }
    setHardBreaks(this.hardBreaks)
    setLinkWriting(this.linkFormat)
    setHighlightColour(this.highlight)
    this.applyZoom()
    if (this.alwaysOnTop) this.applyAlwaysOnTop()
    this.applyFrame()
    this.applyHand()
    this.applyFonts()
    if (isDesktop) {
      const chosen = this.spellLanguages
      void import('../../spelling/src/api').then((one) => one.tellEngine(one.inForceNow(chosen)))
    }
    this.written = isRecord(saved) ? saved : fieldsOf(this.state())
    if (stale) this.persist()
    for (const view of this.views) this.apply(view)
  }
  private written: Record<string, unknown> | null = null
  toggleAlwaysOnTop() {
    this.alwaysOnTop = !this.alwaysOnTop
    this.applyAlwaysOnTop()
    this.persist()
  }
  async askInterfaceZoom() {
    this.interfaceZoom = await invoke<number>('interface_zoom_chosen')
  }
  async setInterfaceZoom(factor: number) {
    await invoke('interface_zoom_choose', { factor })
      .then(() => {
        this.interfaceZoom = factor
      })
      .catch(() => undefined)
  }
  setFrame(value: string) {
    const wanted = frameChoice(value)
    if (!wanted || wanted === this.frame) return
    this.frame = wanted
    this.applyFrame()
    this.persist()
  }
  private applyFrame() {
    document.documentElement.dataset.frame = this.frame
    if (!isDesktop) return
    void invoke('set_frame', { system: this.frame === 'system' }).catch(() => undefined)
  }
  private applyAlwaysOnTop() {
    void currentWindow()
      .then((window) => window.setAlwaysOnTop(this.alwaysOnTop))
      .catch(() => undefined)
  }
  private readonly views = new Set<EditorView>()
  private readonly shown = new WeakMap<EditorView, Shown>()
  shows(view: EditorView, tab: Shown['tab'], kept: () => void) {
    this.shown.set(view, { tab, kept })
  }
  sourceIn(view: EditorView | undefined): boolean {
    const tab = view ? this.shown.get(view)?.tab : undefined
    return !!tab?.source && !this.readOnly
  }
  private each(view: EditorView | undefined, apply: (one: EditorView) => void) {
    if (view) apply(view)
    for (const one of this.views) if (one !== view) apply(one)
  }
  get settings(): ModeSettings {
    return {
      source: this.opensInSource && !this.readOnly,
      readOnly: this.readOnly,
      focus: this.focus,
      quietMarks: this.quietMarks,
      typewriter: this.typewriter,
      punctuation: this.punctuation,
      numbers: this.numbers,
      lineNumbers: this.lineNumbers,
      codeTheme: this.codeTheme,
      rtl: this.rtl,
      strict: this.strict,
      equationNumbers: this.equationNumbers,
      spellcheck: this.spellcheck,
      dictionary: this.dictionary,
      closeBrackets: this.closeBrackets,
      vim: this.vim,
    }
  }
  settingsFor(tab: Shown['tab']): ModeSettings {
    return { ...this.settings, source: tab.source && !this.readOnly }
  }
  apply(view: EditorView) {
    this.views.add(view)
    const tab = this.shown.get(view)?.tab
    view.dispatch({ effects: modeEffects(tab ? this.settingsFor(tab) : this.settings) })
    setMeasure(view, this.width)
    setLineHeight(view, this.lineHeight)
  }
  forget(view: EditorView) {
    this.views.delete(view)
    this.vimModes.delete(view)
  }
  toggleSource(view?: EditorView) {
    const shown = view ? this.shown.get(view) : undefined
    if (!view || !shown) return
    const on = !this.sourceIn(view)
    shown.tab.source = on
    shown.kept()
    if (!on || !this.readOnly) {
      setSourceMode(view, on)
      return
    }
    this.lock(false, view)
    this.persist()
  }
  toggleOpensInSource() {
    this.opensInSource = !this.opensInSource
    opening.source = this.opensInSource
    this.persist()
  }
  toggleReadOnly(view?: EditorView) {
    this.lock(!this.readOnly, view)
    this.persist()
  }
  private lock(on: boolean, view?: EditorView) {
    this.readOnly = on
    this.each(view, (one) => {
      setReadOnlyMode(one, on)
      if (!on && this.shown.get(one)?.tab.source) setSourceMode(one, true)
    })
  }
  toggleFocus(view?: EditorView) {
    this.flip('focus', setFocusMode, view)
  }
  toggleQuietMarks(view?: EditorView) {
    this.quietMarks = !this.quietMarks
    this.each(view, (one) => setQuietMarks(one, this.quietMarks))
    this.persist()
    this.share({ quietMarks: this.quietMarks })
  }
  toggleSilent() {
    this.silent = !this.silent
    this.persist()
    this.share({ silent: this.silent })
  }
  get coder(): boolean {
    return this.developer !== false
  }
  setDeveloper(on: boolean) {
    const first = this.developer === null
    this.developer = on
    if (first && this.quietMarks === on) this.toggleQuietMarks()
    this.persist()
    this.share({ developer: on })
  }
  toggleHand() {
    this.hand = !this.hand
    this.applyHand()
    this.persist()
  }
  setFont(place: FontPlace, family: string) {
    this.fonts = { ...this.fonts, [place]: familyName(family) }
    this.applyFonts()
    this.each(undefined, (one) => one.requestMeasure())
    this.persist()
  }
  private applyFonts() {
    const root = document.documentElement.style
    for (const place of FONT_PLACES) {
      const family = this.fonts[place]
      root.setProperty(`--font-${place}-chosen`, family ? `"${family}",` : '')
    }
  }
  private applyHand() {
    if (this.hand) document.documentElement.dataset.pointer = 'hand'
    else delete document.documentElement.dataset.pointer
  }
  toggleTypewriter(view?: EditorView) {
    this.flip('typewriter', setTypewriterMode, view)
  }
  togglePunctuation(view?: EditorView) {
    this.flip('punctuation', setSmartPunctuation, view)
  }
  toggleNumbers(view?: EditorView) {
    this.flip('numbers', setHeadingNumbers, view)
  }
  toggleLineNumbers(view?: EditorView) {
    this.flip('lineNumbers', setCodeLineNumbers, view)
  }
  setCodeTheme(id: string, view?: EditorView) {
    this.codeTheme = id
    this.each(view, (one) => setCodeTheme(one, id))
    this.persist()
  }
  toggleSpellcheck(view?: EditorView) {
    this.flip('spellcheck', (one, on) => setSpellcheck(one, on, this.dictionary), view)
  }
  private get dictionary(): string | undefined {
    return this.spellLanguages.length === 1 ? this.spellLanguages[0] : undefined
  }
  setSpellLanguages(chosen: string[], view?: EditorView) {
    this.spellLanguages = chosen
    this.each(view, (one) => setSpellcheck(one, this.spellcheck, this.dictionary))
    this.persist()
  }
  setHighlightTone(tone: number | null) {
    this.take('highlightTone', highlightTone(tone).tone, true, () => setHighlightColour(this.highlight))
  }
  get highlight(): HighlightColour {
    return highlightTone(this.highlightTone)
  }
  toggleHardBreaks() {
    this.hardBreaks = !this.hardBreaks
    setHardBreaks(this.hardBreaks)
    this.persist()
    this.share({ hardBreaks: this.hardBreaks })
  }
  setLinkFormat(format: string) {
    this.take('linkFormat', isLinkFormat(format) ? format : undefined, true, setLinkWriting)
  }
  toggleVim(view?: EditorView) {
    this.setVimKeys(!this.vim, view)
  }
  setVimKeys(on: boolean, view?: EditorView) {
    this.take('vim', on, true, () => this.each(view, (one) => setVim(one, on)))
  }
  vimModeOf(view: EditorView | undefined): VimMode | null {
    return (view && this.vimModes.get(view)) ?? null
  }
  setAttachments(value: string) {
    if (!isAttachmentFolder(value)) return
    this.attachments = value
    this.persist()
    this.share({ attachments: value })
  }
  setPagesPaper(value: string) {
    if (!isPaper(value)) return
    this.pagesPaper = value
    this.persist()
  }
  setConflicts(value: string) {
    const rule = conflictRule(value)
    if (!rule) return
    this.conflicts = rule
    this.persist()
    this.share({ conflicts: rule })
  }
  setKeepVersions(days: number) {
    this.take('keepVersions', keepingOf(days))
  }
  setRemindBefore(minutes: number) {
    this.take('remindBefore', remindingOf(minutes))
  }
  setCanvasTurns(on: boolean) {
    this.take('canvasTurns', on)
  }
  setCanvasTurnSnaps(on: boolean) {
    this.take('canvasTurnSnaps', on)
  }
  async adopt(token: string): Promise<AccountSettings | null> {
    const asked = this.owed.sends
    const session = this.owed.session
    await this.owed.settle(token)
    if (this.owed.session !== session) return null
    let remote: AccountSettings
    try {
      const answer = await api.settings(token)
      if (this.owed.session !== session) return null
      remote = answer.settings
      if (answer.key?.set) void api.removeAskKey(token).catch(() => undefined)
    } catch {
      return null
    }
    if (this.owed.sends === asked && !this.owed.standing) {
      for (const key of Object.keys(this.synced) as (keyof Modes)[]) {
        this.follow(key, this.synced[key], (remote as Record<string, unknown>)[key])
      }
    }
    this.tellOfMobile(token, remote)
    return remote
  }
  private tellOfMobile(token: string, remote: AccountSettings): void {
    if (remote.mobileSeen === true) {
      if (!this.mobileSeen) {
        this.mobileSeen = true
        this.persist()
      }
      return
    }
    if (!viewport.touch) return
    this.mobileSeen = true
    this.persist()
    void api.saveSettings(token, { mobileSeen: true }).catch(() => undefined)
  }
  private readonly synced: Synced = {
    vim: { read: flag, start: DEFAULTS.vim, then: (on) => this.each(undefined, (one) => setVim(one, on)) },
    attachments: { read: (value) => (isAttachmentFolder(value) ? value : undefined), start: DEFAULTS.attachments },
    conflicts: { read: (value) => conflictRule(value) ?? undefined, start: DEFAULTS.conflicts },
    keepVersions: { read: keepingOf, start: DEFAULTS.keepVersions },
    remindBefore: { read: remindingOf, start: DEFAULTS.remindBefore },
    canvasTurns: { read: flag, start: DEFAULTS.canvasTurns },
    canvasTurnSnaps: { read: flag, start: DEFAULTS.canvasTurnSnaps },
    highlightTone: {
      read: toneOf,
      start: DEFAULTS.highlightTone,
      then: () => setHighlightColour(this.highlight),
    },
    quietMarks: {
      read: flag,
      start: DEFAULTS.quietMarks,
      then: (on) => this.each(undefined, (one) => setQuietMarks(one, on)),
    },
    silent: { read: flag, start: DEFAULTS.silent },
    developer: { read: flag, start: null },
    hardBreaks: { read: flag, start: DEFAULTS.hardBreaks, then: setHardBreaks },
    linkFormat: {
      read: (value) => (isLinkFormat(value) ? value : undefined),
      start: DEFAULTS.linkFormat,
      then: setLinkWriting,
    },
    mobileSeen: { read: (value) => (value === true ? true : undefined), start: DEFAULTS.mobileSeen },
  }
  private follow<K extends keyof Modes>(key: K, synced: Follow<Modes[K]> | undefined, value: unknown) {
    if (synced) this.take(key, synced.read(value), false, (one) => synced.then?.(one))
  }
  private startOver<K extends keyof Modes>(key: K, synced: Follow<Modes[K]> | undefined, owed: unknown) {
    if (!synced) return
    const value = synced.read(owed) ?? synced.start
    Object.assign(this, { [key]: value })
    synced.then?.(value)
  }
  private backToDefaults(owed: AccountSettings) {
    const said = owed as Record<string, unknown>
    for (const key of Object.keys(this.synced) as (keyof Modes)[]) this.startOver(key, this.synced[key], said[key])
    this.persist()
  }
  private readonly owed = new AccountOwed(OWED_KEY, undefined, (owed) => this.backToDefaults(owed))
  private share(patch: AccountSettings) {
    this.owed.send(patch)
  }
  private take<K extends keyof Modes>(
    key: K,
    value: Modes[K] | undefined,
    shared = true,
    then?: (one: Modes[K]) => void,
  ) {
    if (value === undefined || value === this[key]) return
    Object.assign(this, { [key]: value })
    then?.(value)
    this.persist()
    if (shared) this.share({ [key]: value })
  }
  private flip(
    key:
      | 'focus'
      | 'typewriter'
      | 'punctuation'
      | 'numbers'
      | 'lineNumbers'
      | 'spellcheck'
      | 'closeBrackets'
      | 'strict'
      | 'equationNumbers'
      | 'rtl',
    set: (view: EditorView, on: boolean) => void,
    view?: EditorView,
  ) {
    this[key] = !this[key]
    this.each(view, (one) => set(one, this[key]))
    this.persist()
  }
  toggleCloseBrackets(view?: EditorView) {
    this.flip('closeBrackets', setCloseBrackets, view)
  }
  toggleStrict(view?: EditorView) {
    this.flip('strict', setStrictMode, view)
  }
  toggleEquationNumbers(view?: EditorView) {
    this.flip('equationNumbers', setEquationNumbers, view)
  }
  toggleRightToLeft(view?: EditorView) {
    this.flip('rtl', setRightToLeft, view)
  }
  setZoom(value: number) {
    const nearest = clamp(value, ZOOM_STEPS)
    this.zoom =
      nearest === this.zoom && value !== nearest
        ? step(ZOOM_STEPS, nearest, value > nearest ? 1 : -1, DEFAULTS.zoom)
        : nearest
    this.applyZoom()
    this.persist()
  }
  setWidth(value: number, view?: EditorView) {
    this.width = Math.round(value)
    this.each(view, (one) => setMeasure(one, this.width))
    this.persist()
  }
  setLineSpacing(value: number, view?: EditorView) {
    this.lineHeight = Math.round(value * 100) / 100
    this.each(view, (one) => setLineHeight(one, this.lineHeight))
    this.persist()
  }
  stepWidth(direction: number, view?: EditorView) {
    this.width = step(WIDTHS, this.width, direction, DEFAULTS.width)
    this.each(view, (one) => setMeasure(one, this.width))
    this.persist()
  }
  stepLineHeight(direction: number, view?: EditorView) {
    this.lineHeight = step(LINE_HEIGHTS, this.lineHeight, direction, DEFAULTS.lineHeight)
    this.each(view, (one) => setLineHeight(one, this.lineHeight))
    this.persist()
  }
  stepZoom(direction: number) {
    this.zoom = step(ZOOM_STEPS, this.zoom, direction, DEFAULTS.zoom)
    this.applyZoom()
    this.persist()
  }
  resetZoom() {
    this.zoom = 1
    this.applyZoom()
    this.persist()
  }
  private applyZoom() {
    document.documentElement.style.setProperty('--zoom', String(this.zoom))
    for (const one of this.views) remeasure(one)
  }
  private persist() {
    const fields = fieldsOf(this.state())
    const seen = this.written
    this.written = fields
    const now = stored(STORAGE_KEY)
    if (!seen || !isRecord(now)) {
      keepJson(STORAGE_KEY, fields)
      return
    }
    const merged = Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [
        name,
        JSON.stringify(value) === JSON.stringify(seen[name]) && name in now ? now[name] : value,
      ]),
    )
    for (const [name, value] of Object.entries(now)) {
      if (!(name in fields) && !(name in seen)) merged[name] = value
    }
    keepJson(STORAGE_KEY, merged)
  }
  private state(): Saved {
    return {
      source: this.opensInSource,
      readOnly: this.readOnly,
      focus: this.focus,
      quietMarks: this.quietMarks,
      silent: this.silent,
      ...(this.developer === null ? {} : { developer: this.developer }),
      typewriter: this.typewriter,
      punctuation: this.punctuation,
      numbers: this.numbers,
      lineNumbers: this.lineNumbers,
      codeTheme: this.codeTheme,
      rtl: this.rtl,
      strict: this.strict,
      equationNumbers: this.equationNumbers,
      zoom: this.zoom,
      width: this.width,
      lineHeight: this.lineHeight,
      spellcheck: this.spellcheck,
      spellLanguages: this.spellLanguages,
      alwaysOnTop: this.alwaysOnTop,
      closeBrackets: this.closeBrackets,
      mobileSeen: this.mobileSeen,
      vim: this.vim,
      attachments: this.attachments,
      pagesPaper: this.pagesPaper,
      frame: this.frame,
      hand: this.hand,
      fonts: this.fonts,
      conflicts: this.conflicts,
      keepVersions: this.keepVersions,
      remindBefore: this.remindBefore,
      turnsCanvas: this.canvasTurns,
      canvasTurnSnaps: this.canvasTurnSnaps,
      highlightTone: this.highlightTone,
      hardBreaks: this.hardBreaks,
      linkFormat: this.linkFormat,
    }
  }
}
function fieldsOf(state: Saved): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>
}
export const modes = new Modes()
