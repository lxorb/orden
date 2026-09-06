import {
  setCloseBrackets,
  setCodeLineNumbers,
  setCodeTheme,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setLineHeight,
  setMeasure,
  setReadingMode,
  setRightToLeft,
  setEquationNumbers,
  setSmartPunctuation,
  remeasure,
  setSourceMode,
  setSpellcheck,
  setStrictMode,
  setTypewriterMode,
  type EditorView,
} from '@nib/editor'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { isNumber, isRecord, isString, stored } from './stored'

const STORAGE_KEY = 'nib:modes'
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]

/** Writing column widths, in rem. */
export const WIDTHS = [32, 38, 42, 50, 60, 80] as const
export const LINE_HEIGHTS = [1.5, 1.62, 1.72, 1.85, 2] as const

interface Saved {
  source: boolean
  reading: boolean
  focus: boolean
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
  spellLanguage: string
  closeBrackets: boolean
  ligatures: boolean
}

/** Nearest of the steps the keyboard uses, so both routes agree. */
function clamp(value: number, steps: readonly number[]): number {
  return steps.reduce((best, one) => (Math.abs(one - value) < Math.abs(best - value) ? one : best))
}

/** One step along a fixed list, clamped at both ends. A value that is not one
 *  of the steps - written by an older build, or set from a slider - starts from
 *  `fallback`, which is. */
function step<T extends number>(
  steps: readonly T[],
  current: number,
  direction: number,
  fallback: T,
): T {
  const at = steps.findIndex((one) => one === current)
  const from = at >= 0 ? at : steps.findIndex((one) => one === fallback)
  return steps[Math.min(steps.length - 1, Math.max(0, from + direction))] ?? fallback
}

/** A stored string, when there is one worth having. */
function text(value: unknown, fallback: string): string {
  return isString(value) && value ? value : fallback
}

/** A stored number, when it is a real one. Zero is not a size or a zoom, so it
 *  reads as nothing written. */
function measure(value: unknown, fallback: number): number {
  return isNumber(value) && value !== 0 ? value : fallback
}

class Modes {
  source = $state(false)
  /** The note as it reads, with nothing that writes to it. Never on at the
   *  same time as source mode, and never shared with the account: which of a
   *  note's two faces is up this minute is not a preference. */
  reading = $state(false)
  focus = $state(false)
  typewriter = $state(false)
  punctuation = $state(true)
  numbers = $state(false)
  lineNumbers = $state(false)
  codeTheme = $state('follow')
  rtl = $state(false)
  strict = $state(false)
  equationNumbers = $state(false)
  zoom = $state(1)
  width = $state(42)
  lineHeight = $state(1.72)
  spellcheck = $state(false)
  /** The dictionary to check against; `system` leaves it to the browser. */
  spellLanguage = $state('system')
  closeBrackets = $state(true)
  /** `->` shown as an arrow, `<=` as a sign, and so on. Off until chosen;
   *  the choice follows the account. */
  ligatures = $state(false)

  restore() {
    // Field by field off an unknown, not a cast: the entry may have been
    // written by another version of the app or edited by hand, and a mode that
    // reads as neither on nor off should simply be the default.
    const saved = stored(STORAGE_KEY)
    if (isRecord(saved)) {
      this.source = saved.source === true
      // Both at once is a state the app cannot get into; a hand-edited entry
      // can say it anyway, and source mode is the one that was written last.
      this.reading = saved.reading === true && !this.source
      this.focus = saved.focus === true
      this.typewriter = saved.typewriter === true
      this.punctuation = saved.punctuation !== false
      this.numbers = saved.numbers === true
      this.lineNumbers = saved.lineNumbers === true
      this.codeTheme = text(saved.codeTheme, 'follow')
      this.rtl = saved.rtl === true
      this.strict = saved.strict === true
      this.equationNumbers = saved.equationNumbers === true
      this.zoom = measure(saved.zoom, 1)
      this.width = measure(saved.width, 42)
      this.lineHeight = measure(saved.lineHeight, 1.72)
      this.spellcheck = saved.spellcheck === true
      this.spellLanguage = text(saved.spellLanguage, 'system')
      this.closeBrackets = saved.closeBrackets !== false
      this.ligatures = saved.ligatures === true
    }
    this.applyZoom()
  }

  /** The view on screen, so a zoom from the keyboard or the menu can tell it
   *  to measure again. */
  private view: EditorView | undefined

  /** Re-applies every mode to a freshly created view. */
  apply(view: EditorView) {
    this.view = view

    setSourceMode(view, this.source)
    setReadingMode(view, this.reading)
    setFocusMode(view, this.focus)
    setTypewriterMode(view, this.typewriter)
    setSmartPunctuation(view, this.punctuation)
    setHeadingNumbers(view, this.numbers)
    setCodeLineNumbers(view, this.lineNumbers)
    setCodeTheme(view, this.codeTheme)
    setRightToLeft(view, this.rtl)
    setStrictMode(view, this.strict)
    setEquationNumbers(view, this.equationNumbers)
    setMeasure(view, this.width)
    setLineHeight(view, this.lineHeight)
    setSpellcheck(view, this.spellcheck, this.dictionary)
    setCloseBrackets(view, this.closeBrackets)
    setLigatures(view, this.ligatures)
  }

  toggleSource(view?: EditorView) {
    this.source = !this.source
    if (this.source) this.reading = false
    if (view) setSourceMode(view, this.source)
    this.persist()
  }

  /** The editor keeps the same rule on its side, in setReadingMode: the two
   *  are opposite answers to the same question, so one going on takes the
   *  other off. Here it is the ticks in the menu that have to agree. */
  toggleReading(view?: EditorView) {
    this.reading = !this.reading
    if (this.reading) this.source = false
    if (view) setReadingMode(view, this.reading)
    this.persist()
  }

  toggleFocus(view?: EditorView) {
    this.focus = !this.focus
    if (view) setFocusMode(view, this.focus)
    this.persist()
  }

  toggleTypewriter(view?: EditorView) {
    this.typewriter = !this.typewriter
    if (view) setTypewriterMode(view, this.typewriter)
    this.persist()
  }

  togglePunctuation(view?: EditorView) {
    this.punctuation = !this.punctuation
    if (view) setSmartPunctuation(view, this.punctuation)
    this.persist()
  }

  toggleNumbers(view?: EditorView) {
    this.numbers = !this.numbers
    if (view) setHeadingNumbers(view, this.numbers)
    this.persist()
  }

  toggleLineNumbers(view?: EditorView) {
    this.lineNumbers = !this.lineNumbers
    if (view) setCodeLineNumbers(view, this.lineNumbers)
    this.persist()
  }

  /** Code fences are coloured on their own, so a light theme can hold a dark
   *  fence and the other way round. */
  setCodeTheme(id: string, view?: EditorView) {
    this.codeTheme = id
    if (view) setCodeTheme(view, id)
    this.persist()
  }

  toggleSpellcheck(view?: EditorView) {
    this.spellcheck = !this.spellcheck
    if (view) setSpellcheck(view, this.spellcheck, this.dictionary)
    this.persist()
  }

  /** What the checker reads against: a tag when one was chosen, nothing when
   *  the browser is to pick. */
  private get dictionary(): string | undefined {
    return this.spellLanguage === 'system' ? undefined : this.spellLanguage
  }

  setSpellLanguage(value: string, view?: EditorView) {
    this.spellLanguage = value
    if (view) setSpellcheck(view, this.spellcheck, this.dictionary)
    this.persist()
  }

  toggleLigatures(view?: EditorView) {
    this.ligatures = !this.ligatures
    if (view) setLigatures(view, this.ligatures)
    this.persist()
    this.share({ ligatures: this.ligatures })
  }

  /** Takes over the account's settings: signing in on a new machine brings
   *  them along, and a change made on another shows up at the next start.
   *  What the account has not decided stays as this machine had it.
   *
   *  Hands back everything the account holds, settings this store knows
   *  nothing about included, so the one request answers for all of them. The
   *  shortcuts are taken from it in App.svelte; see shortcuts.svelte.ts. */
  async adopt(token: string): Promise<AccountSettings | null> {
    // What this machine had said before the question went out. Anything it
    // says while the answer is in the air is newer than the answer, so the
    // answer stops being worth adopting: the account already has the newer
    // value, and taking the older one back would undo the reader's own switch.
    const asked = this.sent

    let remote: AccountSettings
    try {
      remote = (await api.settings(token)).settings
    } catch {
      return null
    }

    const theirs = remote.ligatures
    if (typeof theirs === 'boolean' && this.sent === asked && theirs !== this.ligatures) {
      this.ligatures = theirs
      if (this.view) setLigatures(this.view, theirs)
      this.persist()
    }

    return remote
  }

  /** How many choices this machine has made since it started. Counted whether
   *  or not there was an account to tell, because what it is for is telling an
   *  answer that set off earlier from one that set off later. */
  private sent = 0

  /** Tells the account, when there is one. A machine that is offline keeps
   *  its own choice; the next change made online carries it up. */
  private share(patch: AccountSettings) {
    this.sent++

    const token = account.token
    if (!token) return
    void api.saveSettings(token, patch).catch(() => undefined)
  }

  toggleCloseBrackets(view?: EditorView) {
    this.closeBrackets = !this.closeBrackets
    if (view) setCloseBrackets(view, this.closeBrackets)
    this.persist()
  }

  toggleStrict(view?: EditorView) {
    this.strict = !this.strict
    if (view) setStrictMode(view, this.strict)
    this.persist()
  }

  toggleEquationNumbers(view?: EditorView) {
    this.equationNumbers = !this.equationNumbers
    if (view) setEquationNumbers(view, this.equationNumbers)
    this.persist()
  }

  toggleRightToLeft(view?: EditorView) {
    this.rtl = !this.rtl
    if (view) setRightToLeft(view, this.rtl)
    this.persist()
  }

  /** The sliders in preferences set a value outright; the keyboard steps
   *  through the same range. Both land in the same place. */
  setZoom(value: number) {
    this.zoom = clamp(value, ZOOM_STEPS)
    this.applyZoom()
    this.persist()
  }

  setWidth(value: number, view?: EditorView) {
    this.width = Math.round(value)
    if (view) setMeasure(view, this.width)
    this.persist()
  }

  setLineSpacing(value: number, view?: EditorView) {
    this.lineHeight = Math.round(value * 100) / 100
    if (view) setLineHeight(view, this.lineHeight)
    this.persist()
  }

  /** Steps through the widths rather than offering a slider of nothing. */
  stepWidth(direction: number, view?: EditorView) {
    this.width = step(WIDTHS, this.width, direction, 42)
    if (view) setMeasure(view, this.width)
    this.persist()
  }

  stepLineHeight(direction: number, view?: EditorView) {
    this.lineHeight = step(LINE_HEIGHTS, this.lineHeight, direction, 1.72)
    if (view) setLineHeight(view, this.lineHeight)
    this.persist()
  }

  stepZoom(direction: number) {
    this.zoom = step(ZOOM_STEPS, this.zoom, direction, 1)
    this.applyZoom()
    this.persist()
  }

  resetZoom() {
    this.zoom = 1
    this.applyZoom()
    this.persist()
  }

  /** Zoom is the one metric that cannot live on the view: `--text-content` is
   *  worked out at the root, so `--zoom` has to be set there too. Which means
   *  nothing tells the editor its text just changed size - hence the view kept
   *  above, and this. */
  private applyZoom() {
    document.documentElement.style.setProperty('--zoom', String(this.zoom))
    if (this.view) remeasure(this.view)
  }

  private persist() {
    const state: Saved = {
      source: this.source,
      reading: this.reading,
      focus: this.focus,
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
      spellLanguage: this.spellLanguage,
      closeBrackets: this.closeBrackets,
      ligatures: this.ligatures,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export const modes = new Modes()
