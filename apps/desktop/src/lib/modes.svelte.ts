import {
  setCloseBrackets,
  setCodeLineNumbers,
  setCodeTheme,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setLineHeight,
  setMeasure,
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

const STORAGE_KEY = 'nib:modes'
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]

/** Writing column widths, in rem. */
export const WIDTHS = [32, 38, 42, 50, 60, 80] as const
export const LINE_HEIGHTS = [1.5, 1.62, 1.72, 1.85, 2] as const

interface Saved {
  source: boolean
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
  spellcheck?: boolean
  spellLanguage?: string
  closeBrackets?: boolean
  ligatures?: boolean
}

/** Nearest of the steps the keyboard uses, so both routes agree. */
function clamp(value: number, steps: readonly number[]): number {
  return steps.reduce((best, one) => (Math.abs(one - value) < Math.abs(best - value) ? one : best))
}

class Modes {
  source = $state(false)
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
  /** `->` shown as an arrow, `<=` as a sign, and so on. */
  ligatures = $state(true)

  restore() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const state = JSON.parse(saved) as Saved
        this.source = !!state.source
        this.focus = !!state.focus
        this.typewriter = !!state.typewriter
        this.punctuation = state.punctuation ?? true
        this.numbers = !!state.numbers
        this.lineNumbers = !!state.lineNumbers
        this.codeTheme = state.codeTheme || 'follow'
        this.rtl = !!state.rtl
        this.strict = !!state.strict
        this.equationNumbers = !!state.equationNumbers
        this.zoom = state.zoom || 1
        this.width = state.width || 42
        this.lineHeight = state.lineHeight || 1.72
        this.spellcheck = state.spellcheck ?? false
        this.spellLanguage = state.spellLanguage || 'system'
        this.closeBrackets = state.closeBrackets ?? true
        this.ligatures = state.ligatures ?? true
      } catch {
        // A corrupt entry just means defaults.
      }
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
    if (view) setSourceMode(view, this.source)
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
    const index = WIDTHS.indexOf(this.width as (typeof WIDTHS)[number])
    const from = index >= 0 ? index : WIDTHS.indexOf(42)
    const next = Math.min(WIDTHS.length - 1, Math.max(0, from + direction))

    this.width = WIDTHS[next]
    if (view) setMeasure(view, this.width)
    this.persist()
  }

  stepLineHeight(direction: number, view?: EditorView) {
    const index = LINE_HEIGHTS.indexOf(this.lineHeight as (typeof LINE_HEIGHTS)[number])
    const from = index >= 0 ? index : LINE_HEIGHTS.indexOf(1.72)
    const next = Math.min(LINE_HEIGHTS.length - 1, Math.max(0, from + direction))

    this.lineHeight = LINE_HEIGHTS[next]
    if (view) setLineHeight(view, this.lineHeight)
    this.persist()
  }

  stepZoom(direction: number) {
    const index = ZOOM_STEPS.indexOf(this.zoom)
    const from = index >= 0 ? index : ZOOM_STEPS.indexOf(1)
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction))

    this.zoom = ZOOM_STEPS[next]
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
