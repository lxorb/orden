import { ACCENTS, accentTokens, DEFAULT_ACCENT } from './accents'
import { invoke, isDesktop } from './tauri'

export type Scheme = 'dark' | 'light'

export interface ThemeInfo {
  id: string
  name: string
  scheme: Scheme
  path?: string
}

interface ThemeFile {
  id: string
  name: string
  path: string
}

const STORAGE_KEY = 'nib:theme'
const STYLE_ID = 'nib-user-theme'
const CUSTOM_ID = 'nib-custom-css'

/** Not a theme of its own: whichever built-in the system asks for, live. */
export const SYSTEM = 'system'

// Two schemes, and a colour of your own on top. More built-in themes only
// asked people to choose between things that were nearly the same.
const BUILT_IN: ThemeInfo[] = [
  { id: 'dark', name: 'Dark', scheme: 'dark' },
  { id: 'light', name: 'Light', scheme: 'light' },
]

const ACCENT_KEY = 'nib:accent'

const LIGHT = '(prefers-color-scheme: light)'

class Themes {
  id = $state<string>(SYSTEM)
  accent = $state<string>(DEFAULT_ACCENT)
  files = $state<ThemeInfo[]>([])
  /** What the system currently prefers. Kept up to date, so following it
   *  means following it through the day and not only at launch. */
  private preferred = $state<Scheme>('dark')

  readonly accents = ACCENTS

  /** The choice at the top is to follow the system; the rest are themes. */
  readonly all = $derived<ThemeInfo[]>([
    { id: SYSTEM, name: 'Match the system', scheme: this.preferred },
    ...BUILT_IN,
    ...this.files,
  ])
  readonly active = $derived.by((): ThemeInfo => {
    if (this.id === SYSTEM) return BUILT_IN.find((one) => one.scheme === this.preferred)!
    return this.all.find((theme) => theme.id === this.id) ?? BUILT_IN[0]
  })
  readonly current = $derived(this.active.scheme)

  init() {
    const light = window.matchMedia(LIGHT)
    this.preferred = light.matches ? 'light' : 'dark'
    light.addEventListener('change', (event) => {
      this.preferred = event.matches ? 'light' : 'dark'
      if (this.id === SYSTEM) this.apply()
    })

    const saved = localStorage.getItem(STORAGE_KEY)
    this.id = saved && saved !== 'null' ? saved : SYSTEM
    this.accent = localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT
    this.apply()
    void this.reload()
  }

  /** Rescans the themes folder, so dropping in a file needs no restart. */
  async reload() {
    if (!isDesktop) return

    try {
      const found = await invoke<ThemeFile[]>('list_themes')
      const loaded: ThemeInfo[] = []

      for (const file of found) {
        const css = await invoke<string>('read_theme', { path: file.path })
        loaded.push({
          ...file,
          scheme: /color-scheme\s*:\s*light/.test(css) ? 'light' : 'dark',
        })
      }

      this.files = loaded
    } catch {
      this.files = []
    }

    // A theme file may have been deleted while it was selected.
    if (!this.all.some((theme) => theme.id === this.id)) this.select(SYSTEM)

    await this.loadCustom()
  }

  /** `custom.css` applies on top of whichever theme is active. */
  private async loadCustom() {
    if (!isDesktop) return

    const css = await invoke<string>('read_custom_css').catch(() => '')
    let style = document.getElementById(CUSTOM_ID)

    if (!css.trim()) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = CUSTOM_ID
      // Last in <head>, so it outranks the theme it sits on top of.
      document.head.append(style)
    }
    style.textContent = css
  }

  select(id: string) {
    this.id = id
    this.apply()
    localStorage.setItem(STORAGE_KEY, id)
  }

  setAccent(id: string) {
    this.accent = id
    localStorage.setItem(ACCENT_KEY, id)
    this.paintAccent()
  }

  /** Written straight onto the root element, so it sits above whatever theme
   *  is underneath, including one loaded from a file. */
  private paintAccent() {
    const style = document.documentElement.style
    for (const [token, value] of Object.entries(accentTokens(this.accent, this.current))) {
      style.setProperty(token, value)
    }
  }

  /** The rail's one-click switch: jump to the counterpart scheme. An explicit
   *  choice, so it stops following the system until that is chosen again. */
  toggle() {
    const wanted: Scheme = this.current === 'dark' ? 'light' : 'dark'
    const preferred = BUILT_IN.find((theme) => theme.id === wanted)
    const fallback = this.files.find((theme) => theme.scheme === wanted)
    this.select((preferred ?? fallback ?? BUILT_IN[0]).id)
  }

  private apply() {
    const theme = this.active
    // Built-in tokens still provide the base, so a file theme only overrides
    // what it cares about.
    document.documentElement.dataset.theme = theme.path ? theme.scheme : theme.id
    this.paintAccent()
    this.paintSystemBars()

    if (!theme.path) return this.inject('')
    void invoke<string>('read_theme', { path: theme.path }).then((css) => this.inject(css))
  }

  /** Android and iOS tint their own bars from this, which is the difference
   *  between an installed app that ends at the page and one that does not. */
  private paintSystemBars() {
    const tag = document.querySelector('meta[name="theme-color"]')
    if (!tag) return

    // Read back rather than guessed: a theme file may have replaced --bg.
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (background) tag.setAttribute('content', background)
  }

  private inject(css: string) {
    let style = document.getElementById(STYLE_ID)

    if (!css) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      // Before any custom.css block, which must stay last.
      document.head.insertBefore(style, document.getElementById(CUSTOM_ID))
    }
    style.textContent = css
  }
}

export const theme = new Themes()
