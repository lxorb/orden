import {
  modeEffects,
  type ModeSettings,
  setCloseBrackets,
  setCodeLineNumbers,
  setCodeTheme,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setLineHeight,
  setMeasure,
  setQuietMarks,
  setReadOnlyMode,
  setRightToLeft,
  setEquationNumbers,
  setSmartPunctuation,
  remeasure,
  setSourceMode,
  isSpellWord,
  setSpellcheck,
  setSpellWords,
  setHighlightColour,
  setStrictMode,
  setTypewriterMode,
  setVim,
  onVimMode,
  type LigatureScope,
  type VimMode,
  type EditorView,
} from '@orden/editor'
import { setHardBreaks } from '@orden/markdown/breaks'
import { highlightTone, type HighlightColour } from '@orden/markdown/highlights'
import { SvelteMap } from 'svelte/reactivity'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { viewport } from './viewport.svelte'
import { type AttachmentFolder, isAttachmentFolder } from './attachments'
import { isPaper, type Paper } from '@orden/markdown/papers'
import { isLinkFormat, type LinkFormat, setLinkWriting } from './link-format'
import { type ConflictRule, conflictRule, DEFAULT_RULE } from './sync/conflicts'
import {
  type Compaction,
  DEFAULT_COMPACTION,
  isCompaction,
  MARKS,
  type Marks,
} from '@orden/glasses/choices'
import { glassesKey } from './even/key.svelte'
import { type Effort, isEffort } from './even/models'
import { key } from './i18n.svelte'
import { isNumber, isRecord, isString, keepJson, stored, stringList } from './stored'
import { currentWindow, invoke, isDesktop } from './tauri'
import { theme } from './theme.svelte'
import { opening } from './workspace/documents.svelte'

const STORAGE_KEY = 'nib:modes'

const MOST_SPELL_WORDS = 500
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

export const LIGATURE_SCOPES: readonly LigatureScope[] = ['off', 'code', 'all']

export function ligatureScope(value: unknown): LigatureScope | null {
  if (typeof value === 'boolean') return value ? 'all' : 'off'
  return LIGATURE_SCOPES.find((one) => one === value) ?? null
}

export const GLASSES_BREAKS = [0, 1, 2, 3, 4, 5, 6] as const
export type GlassesBreak = (typeof GLASSES_BREAKS)[number]

export function glassesBreak(value: unknown): GlassesBreak | null {
  const wanted = typeof value === 'string' ? Number(value) : value
  return GLASSES_BREAKS.find((one) => one === wanted) ?? null
}

export const LINE_HEIGHTS = [1.5, 1.62, 1.72, 1.85, 2] as const

export const FRAMES = ['nib', 'system'] as const
export type Frame = (typeof FRAMES)[number]

export function frameChoice(value: unknown): Frame | null {
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
  spellWords: string[]
  alwaysOnTop: boolean
  frame: Frame
  hand: boolean
  overviewBlur: boolean
  flushBottom: boolean
  fonts: Record<FontPlace, string>
  closeBrackets: boolean
  ligatures: LigatureScope
  glassesBreak: GlassesBreak
  glassesLineNumbers: boolean
  glassesVoice: boolean
  glassesCompaction: string
  glassesMarks: Marks
  glassesWords: Record<string, unknown>
  glassesSeen: boolean
  mobileSeen: boolean
  glassesModel: string
  glassesEffort: string
  vim: boolean
  attachments: string
  pagesPaper: string
  conflicts: string
  keepVersions: number
  remindBefore: number
  undatedInToday: boolean
  turnsCanvas: boolean
  canvasTurnSnaps: boolean
  highlightTone: number | null
  hardBreaks: boolean
  linkFormat: LinkFormat
}

export const VIM_WORDS: Record<VimMode, string> = {
  normal: key('NORMAL'),
  insert: key('INSERT'),
  visual: key('VISUAL'),
  replace: key('REPLACE'),
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

function marksOf(value: unknown): Marks {
  if (!isRecord(value)) return { ...MARKS }

  const out = { ...MARKS }
  for (const name of Object.keys(MARKS) as (keyof Marks)[]) {
    const found = value[name]
    if (typeof found === 'boolean') out[name] = found
  }

  return out
}

function wordsOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [id, phrase] of Object.entries(value)) {
    if (isString(phrase) && phrase.trim() && phrase.length <= 60) out[id] = phrase.trim()
  }

  return out
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
  frame: 'nib' as Frame,
  hand: false,
  overviewBlur: false,
  flushBottom: false,
  fonts: { ui: '', content: '', mono: '' } as Record<FontPlace, string>,
  closeBrackets: true,
  ligatures: 'off' as LigatureScope,
  glassesBreak: 2 as GlassesBreak,
  glassesLineNumbers: true,
  glassesVoice: false,
  glassesCompaction: DEFAULT_COMPACTION,
  glassesSeen: false,
  mobileSeen: false,
  glassesModel: '',
  glassesEffort: 'low' as Effort,
  vim: false,
  attachments: 'space' as AttachmentFolder,
  pagesPaper: 'a4' as Paper,
  conflicts: DEFAULT_RULE,
  keepVersions: KEEP_MONTH,
  remindBefore: 0,
  undatedInToday: false,
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
  spellWords = $state<string[]>([])
  alwaysOnTop = $state(DEFAULTS.alwaysOnTop)

  frame = $state<Frame>(DEFAULTS.frame)
  hand = $state(DEFAULTS.hand)
  overviewBlur = $state(DEFAULTS.overviewBlur)
  flushBottom = $state(DEFAULTS.flushBottom)
  fonts = $state<Record<FontPlace, string>>({ ...DEFAULTS.fonts })
  closeBrackets = $state(DEFAULTS.closeBrackets)
  ligatures = $state<LigatureScope>(DEFAULTS.ligatures)
  glassesBreak = $state<GlassesBreak>(DEFAULTS.glassesBreak)
  glassesLineNumbers = $state(DEFAULTS.glassesLineNumbers)
  glassesVoice = $state(DEFAULTS.glassesVoice)
  glassesCompaction = $state<Compaction>(DEFAULTS.glassesCompaction)
  glassesMarks = $state<Marks>({ ...MARKS })
  glassesWords = $state<Record<string, string>>({})
  glassesSeen = $state(DEFAULTS.glassesSeen)
  mobileSeen = $state(DEFAULTS.mobileSeen)
  glassesModel = $state(DEFAULTS.glassesModel)
  glassesEffort = $state<Effort>(DEFAULTS.glassesEffort)
  vim = $state(DEFAULTS.vim)
  readonly vimModes = new SvelteMap<EditorView, VimMode>()
  attachments = $state<AttachmentFolder>(DEFAULTS.attachments)

  pagesPaper = $state<Paper>(DEFAULTS.pagesPaper)

  conflicts = $state<ConflictRule>(DEFAULTS.conflicts)

  keepVersions = $state<number>(DEFAULTS.keepVersions)

  remindBefore = $state<number>(DEFAULTS.remindBefore)

  undatedInToday = $state(DEFAULTS.undatedInToday)

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
  }

  restore() {
    let stale = false

    const saved = stored(STORAGE_KEY)
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
        (isString(saved.spellLanguage) && saved.spellLanguage !== 'system'
          ? [saved.spellLanguage]
          : [])
      stale ||= 'spellLanguage' in saved
      this.spellWords = (stringList(saved.spellWords) ?? [])
        .filter(isSpellWord)
        .slice(0, MOST_SPELL_WORDS)
      this.ligatures = ligatureScope(saved.ligatures) ?? DEFAULTS.ligatures
      this.conflicts = conflictRule(saved.conflicts) ?? DEFAULTS.conflicts
      this.keepVersions = keepingOf(saved.keepVersions) ?? DEFAULTS.keepVersions
      this.remindBefore = remindingOf(saved.remindBefore) ?? this.remindBefore
      this.glassesBreak = glassesBreak(saved.glassesBreak) ?? DEFAULTS.glassesBreak
      if (isCompaction(saved.glassesCompaction)) this.glassesCompaction = saved.glassesCompaction
      this.glassesMarks = marksOf(saved.glassesMarks)
      this.glassesWords = wordsOf(saved.glassesWords)
      stale ||= 'glassesScroll' in saved
      this.glassesModel = text(saved.glassesModel, DEFAULTS.glassesModel)
      this.glassesEffort = isEffort(saved.glassesEffort)
        ? saved.glassesEffort
        : DEFAULTS.glassesEffort
      this.frame = frameChoice(saved.frame) ?? DEFAULTS.frame
      if (saved.translucent === true) theme.adoptTranslucency()
      stale ||= 'translucent' in saved
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
      stale ||= 'properties' in saved || 'frontMatter' in saved || 'frontMatterDrawn' in saved
      this.canvasTurns = on(saved.turnsCanvas, DEFAULTS.canvasTurns)
      stale ||= 'canvasTurns' in saved
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
      void import('./spell-languages').then((one) => one.tellEngine(one.inForceNow(chosen)))
    }

    this.written = isRecord(saved) ? saved : fieldsOf(this.state())
    if (stale) this.persist()
    this.hearOthers()
    for (const view of this.views) this.apply(view)
  }

  private written: Record<string, unknown> | null = null

  private hearing = false
  private hearOthers() {
    if (this.hearing || typeof window === 'undefined') return
    this.hearing = true
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return
      this.restore()
      this.applyAlwaysOnTop()
    })
  }

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
      words: this.spellWords,
      closeBrackets: this.closeBrackets,
      ligatures: this.ligatures,
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
    this.focus = !this.focus
    this.each(view, (one) => setFocusMode(one, this.focus))
    this.persist()
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

  toggleOverviewBlur() {
    this.overviewBlur = !this.overviewBlur
    this.persist()
  }

  toggleFlushBottom() {
    this.flushBottom = !this.flushBottom
    this.persist()
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
    this.typewriter = !this.typewriter
    this.each(view, (one) => setTypewriterMode(one, this.typewriter))
    this.persist()
  }

  togglePunctuation(view?: EditorView) {
    this.punctuation = !this.punctuation
    this.each(view, (one) => setSmartPunctuation(one, this.punctuation))
    this.persist()
  }

  toggleNumbers(view?: EditorView) {
    this.numbers = !this.numbers
    this.each(view, (one) => setHeadingNumbers(one, this.numbers))
    this.persist()
  }

  toggleLineNumbers(view?: EditorView) {
    this.lineNumbers = !this.lineNumbers
    this.each(view, (one) => setCodeLineNumbers(one, this.lineNumbers))
    this.persist()
  }

  setCodeTheme(id: string, view?: EditorView) {
    this.codeTheme = id
    this.each(view, (one) => setCodeTheme(one, id))
    this.persist()
  }

  toggleSpellcheck(view?: EditorView) {
    this.spellcheck = !this.spellcheck
    this.each(view, (one) => setSpellcheck(one, this.spellcheck, this.dictionary))
    this.persist()
  }

  private get dictionary(): string | undefined {
    return this.spellLanguages.length === 1 ? this.spellLanguages[0] : undefined
  }

  toggleSpellWord(word: string, view?: EditorView) {
    const wanted = word.trim().toLowerCase()
    if (!isSpellWord(wanted)) return

    const rest = this.spellWords.filter((one) => one !== wanted)
    const words = rest.length === this.spellWords.length ? [...rest, wanted].sort() : rest
    if (words.length > MOST_SPELL_WORDS) return

    this.spellWords = words
    this.each(view, (one) => setSpellWords(one, words))
    this.persist()
    this.share({ spellWords: words })
  }

  knowsWord(word: string): boolean {
    return this.spellWords.includes(word.trim().toLowerCase())
  }

  setSpellLanguages(chosen: string[], view?: EditorView) {
    this.spellLanguages = chosen
    this.each(view, (one) => setSpellcheck(one, this.spellcheck, this.dictionary))
    this.persist()
  }

  setLigatures(scope: string, view?: EditorView) {
    const wanted = ligatureScope(scope)
    if (!wanted || wanted === this.ligatures) return

    this.ligatures = wanted
    this.each(view, (one) => setLigatures(one, wanted))
    this.persist()
    this.share({ ligatures: wanted })
  }

  setHighlightTone(tone: number | null) {
    const wanted = highlightTone(tone).tone
    if (wanted === this.highlightTone) return

    this.highlightTone = wanted
    setHighlightColour(this.highlight)
    this.persist()
    this.share({ highlightTone: wanted })
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
    if (!isLinkFormat(format) || format === this.linkFormat) return

    this.linkFormat = format
    setLinkWriting(format)
    this.persist()
    this.share({ linkFormat: format })
  }

  setGlassesBreak(level: string) {
    const wanted = glassesBreak(level)
    if (wanted === null || wanted === this.glassesBreak) return

    this.glassesBreak = wanted
    this.persist()
    this.share({ glassesBreak: wanted })
  }

  setGlassesLineNumbers(on: boolean) {
    if (on === this.glassesLineNumbers) return

    this.glassesLineNumbers = on
    this.persist()
    this.share({ glassesLineNumbers: on })
  }

  setGlassesVoice(on: boolean) {
    if (on === this.glassesVoice) return

    this.glassesVoice = on
    this.persist()
    this.share({ glassesVoice: on })
  }

  setGlassesCompaction(level: string) {
    if (!isCompaction(level) || level === this.glassesCompaction) return

    this.glassesCompaction = level
    this.persist()
    this.share({ glassesCompaction: level })
  }

  setGlassesMark(name: keyof Marks, on: boolean) {
    if (this.glassesMarks[name] === on) return

    this.glassesMarks = { ...this.glassesMarks, [name]: on }
    this.persist()
    this.share({ glassesMarks: { ...this.glassesMarks } })
  }

  setGlassesWord(id: string, phrase: string) {
    const wanted = phrase.trim().toLowerCase()
    const words = Object.fromEntries(
      Object.entries(this.glassesWords).filter(([one]) => one !== id),
    )
    if (wanted) words[id] = wanted

    this.glassesWords = words
    this.persist()
    this.share({ glassesWords: words })
  }

  private toldOfGlasses = false

  sawGlasses() {
    if (this.toldOfGlasses) return

    this.toldOfGlasses = true
    if (!this.glassesSeen) {
      this.glassesSeen = true
      this.persist()
    }

    this.share({ glassesSeen: true })
  }

  setGlassesModel(model: string) {
    if (model === this.glassesModel) return

    this.glassesModel = model
    this.persist()
    this.share({ glassesModel: model })
  }

  setGlassesEffort(effort: string) {
    if (!isEffort(effort) || effort === this.glassesEffort) return

    this.glassesEffort = effort
    this.persist()
    this.share({ glassesEffort: effort })
  }

  toggleVim(view?: EditorView) {
    this.setVimKeys(!this.vim, view)
  }

  setVimKeys(on: boolean, view?: EditorView) {
    if (on === this.vim) return

    this.vim = on
    this.each(view, (one) => setVim(one, on))
    this.persist()
    this.share({ vim: on })
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
    const wanted = KEEP_VERSIONS.find((one) => one === days)
    if (wanted === undefined || wanted === this.keepVersions) return

    this.keepVersions = wanted
    this.persist()
    this.share({ keepVersions: wanted })
  }

  setRemindBefore(minutes: number) {
    if (!REMIND_BEFORE.includes(minutes) || minutes === this.remindBefore) return

    this.remindBefore = minutes
    this.persist()
    this.share({ remindBefore: minutes })
  }

  setUndatedInToday(on: boolean) {
    if (on === this.undatedInToday) return

    this.undatedInToday = on
    this.persist()
    this.share({ undatedInToday: on })
  }

  setCanvasTurns(on: boolean) {
    if (on === this.canvasTurns) return

    this.canvasTurns = on
    this.persist()
    this.share({ canvasTurns: on })
  }

  setCanvasTurnSnaps(on: boolean) {
    if (on === this.canvasTurnSnaps) return

    this.canvasTurnSnaps = on
    this.persist()
    this.share({ canvasTurnSnaps: on })
  }

  async adopt(token: string): Promise<AccountSettings | null> {
    const asked = this.sent

    await this.settle(token)

    let remote: AccountSettings
    try {
      const answer = await api.settings(token)
      remote = answer.settings
      glassesKey.took(answer.key)
    } catch {
      return null
    }

    const unheard = this.sent === asked

    const theirs = ligatureScope(remote.ligatures)
    if (theirs && unheard && theirs !== this.ligatures) {
      this.ligatures = theirs
      this.each(undefined, (one) => setLigatures(one, theirs))
      this.persist()
    }

    const modal = remote.vim
    if (typeof modal === 'boolean' && unheard && modal !== this.vim) {
      this.vim = modal
      this.each(undefined, (one) => setVim(one, modal))
      this.persist()
    }

    const folder = remote.attachments
    if (isAttachmentFolder(folder) && unheard && folder !== this.attachments) {
      this.attachments = folder
      this.persist()
    }

    const clash = conflictRule(remote.conflicts)
    if (clash && unheard && clash !== this.conflicts) {
      this.conflicts = clash
      this.persist()
    }

    const keeping = keepingOf(remote.keepVersions)
    if (keeping !== undefined && unheard) {
      if (keeping !== this.keepVersions) {
        this.keepVersions = keeping
        this.persist()
      }
    }

    const before = remindingOf(remote.remindBefore)
    if (before !== undefined && unheard) {
      if (before !== this.remindBefore) {
        this.remindBefore = before
        this.persist()
      }
    }

    const undated = remote.undatedInToday
    if (typeof undated === 'boolean' && unheard && undated !== this.undatedInToday) {
      this.undatedInToday = undated
      this.persist()
    }

    const turns = remote.canvasTurns
    if (typeof turns === 'boolean' && unheard && turns !== this.canvasTurns) {
      this.canvasTurns = turns
      this.persist()
    }

    const snaps = remote.canvasTurnSnaps
    if (typeof snaps === 'boolean' && unheard && snaps !== this.canvasTurnSnaps) {
      this.canvasTurnSnaps = snaps
      this.persist()
    }

    const wanted = toneOf(remote.highlightTone)
    if (wanted !== undefined && unheard) {
      if (wanted !== this.highlightTone) {
        this.highlightTone = wanted
        setHighlightColour(this.highlight)
        this.persist()
      }
    }

    const quiet = remote.quietMarks
    if (typeof quiet === 'boolean' && unheard && quiet !== this.quietMarks) {
      this.quietMarks = quiet
      this.each(undefined, (one) => setQuietMarks(one, quiet))
      this.persist()
    }

    const quietly = remote.silent
    if (typeof quietly === 'boolean' && unheard && quietly !== this.silent) {
      this.silent = quietly
      this.persist()
    }

    const coding = remote.developer
    if (typeof coding === 'boolean' && unheard && coding !== this.developer) {
      this.developer = coding
      this.persist()
    }

    const breaking = remote.hardBreaks
    if (typeof breaking === 'boolean' && unheard && breaking !== this.hardBreaks) {
      this.hardBreaks = breaking
      setHardBreaks(breaking)
      this.persist()
    }

    const spelling = remote.linkFormat
    if (isLinkFormat(spelling) && unheard && spelling !== this.linkFormat) {
      this.linkFormat = spelling
      setLinkWriting(spelling)
      this.persist()
    }

    const words = remote.spellWords
    if (Array.isArray(words) && unheard) {
      const kept = words.filter(isSpellWord).slice(0, MOST_SPELL_WORDS)
      if (kept.join('\0') !== this.spellWords.join('\0')) {
        this.spellWords = kept
        this.each(undefined, (one) => setSpellWords(one, kept))
        this.persist()
      }
    }

    if (unheard) this.adoptGlasses(remote)

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

  private adoptGlasses(remote: AccountSettings): void {
    let moved = false
    const took = <T>(value: T | undefined, take: (one: T) => void) => {
      if (value === undefined) return

      take(value)
      moved = true
    }

    const level = glassesBreak(remote.glassesBreak)
    if (level !== null && level !== this.glassesBreak) {
      this.glassesBreak = level
      moved = true
    }

    if (typeof remote.glassesLineNumbers === 'boolean') {
      took(remote.glassesLineNumbers, (on) => (this.glassesLineNumbers = on))
    }
    if (typeof remote.glassesVoice === 'boolean') {
      took(remote.glassesVoice, (on) => (this.glassesVoice = on))
    }
    if (isCompaction(remote.glassesCompaction)) {
      took(remote.glassesCompaction, (level) => (this.glassesCompaction = level))
    }
    if (remote.glassesMarks !== undefined) {
      took(marksOf(remote.glassesMarks), (marks) => (this.glassesMarks = marks))
    }
    if (remote.glassesWords !== undefined) {
      took(wordsOf(remote.glassesWords), (words) => (this.glassesWords = words))
    }
    if (remote.glassesSeen === true) {
      took(true, (seen) => (this.glassesSeen = seen))
      this.toldOfGlasses = true
    }
    if (typeof remote.glassesModel === 'string') {
      took(remote.glassesModel, (model) => (this.glassesModel = model))
    }
    if (isEffort(remote.glassesEffort)) {
      took(remote.glassesEffort, (effort) => (this.glassesEffort = effort))
    }

    if (moved) this.persist()
  }

  private sent = 0

  private owed: AccountSettings = {}

  private share(patch: AccountSettings) {
    this.sent++

    const token = account.accountToken
    if (!token) {
      this.owed = { ...this.owed, ...patch }
      return
    }

    const owed = this.owed
    this.owed = {}
    void api.saveSettings(token, { ...owed, ...patch }).catch(() => {
      this.owed = { ...owed, ...patch, ...this.owed }
    })
  }

  private async settle(token: string): Promise<void> {
    const owed = this.owed
    if (!Object.keys(owed).length) return

    this.owed = {}
    try {
      await api.saveSettings(token, owed)
    } catch {
      this.owed = { ...owed, ...this.owed }
    }
  }

  toggleCloseBrackets(view?: EditorView) {
    this.closeBrackets = !this.closeBrackets
    this.each(view, (one) => setCloseBrackets(one, this.closeBrackets))
    this.persist()
  }

  toggleStrict(view?: EditorView) {
    this.strict = !this.strict
    this.each(view, (one) => setStrictMode(one, this.strict))
    this.persist()
  }

  toggleEquationNumbers(view?: EditorView) {
    this.equationNumbers = !this.equationNumbers
    this.each(view, (one) => setEquationNumbers(one, this.equationNumbers))
    this.persist()
  }

  toggleRightToLeft(view?: EditorView) {
    this.rtl = !this.rtl
    this.each(view, (one) => setRightToLeft(one, this.rtl))
    this.persist()
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
    const state: Saved = {
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
      spellWords: this.spellWords,
      alwaysOnTop: this.alwaysOnTop,
      closeBrackets: this.closeBrackets,
      ligatures: this.ligatures,
      glassesBreak: this.glassesBreak,
      glassesLineNumbers: this.glassesLineNumbers,
      glassesVoice: this.glassesVoice,
      glassesCompaction: this.glassesCompaction,
      glassesMarks: this.glassesMarks,
      glassesWords: this.glassesWords,
      glassesSeen: this.glassesSeen,
      mobileSeen: this.mobileSeen,
      glassesModel: this.glassesModel,
      glassesEffort: this.glassesEffort,
      vim: this.vim,
      attachments: this.attachments,
      pagesPaper: this.pagesPaper,
      frame: this.frame,
      hand: this.hand,
      overviewBlur: this.overviewBlur,
      flushBottom: this.flushBottom,
      fonts: this.fonts,
      conflicts: this.conflicts,
      keepVersions: this.keepVersions,
      remindBefore: this.remindBefore,
      undatedInToday: this.undatedInToday,
      turnsCanvas: this.canvasTurns,
      canvasTurnSnaps: this.canvasTurnSnaps,
      highlightTone: this.highlightTone,
      hardBreaks: this.hardBreaks,
      linkFormat: this.linkFormat,
    }
    return state
  }
}

function fieldsOf(state: Saved): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>
}

export const modes = new Modes()
