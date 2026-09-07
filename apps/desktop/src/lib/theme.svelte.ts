import { ACCENTS, accentTokens, DEFAULT_ACCENT } from './accents'
import { invoke } from './tauri'
import { type Stamp, stampOf } from './themes/validate'

export type Scheme = 'dark' | 'light'

interface ThemeInfo {
  id: string
  name: string
  scheme: Scheme
  /** Which schemes the theme states. A file stating both is a pair: it follows
   *  the app's light and dark switch instead of being one or the other. */
  variants: Scheme[]
  path?: string
  /** Whether the theme states an accent of its own. One that does keeps it: the
   *  card in the store showed that colour, and what the app looks like has to be
   *  what the card showed. */
  ownAccent?: boolean
  /** What the store wrote into the file when it installed it, for a theme that
   *  came from there. Absent for a file somebody put in the folder themselves,
   *  which the store has nothing to say about. */
  stamp?: Stamp
}

interface ThemeFile {
  id: string
  name: string
  path: string
}

const STORAGE_KEY = 'nib:theme'
/** Which side of a theme that states both. */
const SIDE_KEY = 'nib:theme-side'
const STYLE_ID = 'nib-user-theme'
const CUSTOM_ID = 'nib-custom-css'

/** Not a theme of its own: whichever built-in the system asks for, live. */
const SYSTEM = 'system'

// Two schemes, and a colour of your own on top. More built-in themes only
// asked people to choose between things that were nearly the same. Kept by
// scheme as well as in a list, so "the dark one" is a lookup and not a search
// that might come back empty.
const BY_SCHEME: Record<Scheme, ThemeInfo> = {
  dark: { id: 'dark', name: 'Dark', scheme: 'dark', variants: ['dark'] },
  light: { id: 'light', name: 'Light', scheme: 'light', variants: ['light'] },
}

const BUILT_IN: ThemeInfo[] = [BY_SCHEME.dark, BY_SCHEME.light]

const ACCENT_KEY = 'nib:accent'

const LIGHT = '(prefers-color-scheme: light)'

/** Which schemes a theme file states.
 *
 *  A theme written against the tokens says so outright, in a block per scheme.
 *  A Typora theme knows nothing about the attribute and only declares its
 *  `color-scheme`, so that is what is read for one, and it is the one thing it
 *  is: dropping such a file in has always meant choosing a look, not a pair. */
function variantsOf(css: string): Scheme[] {
  const found = (['light', 'dark'] as const).filter((scheme) =>
    new RegExp(`\\[data-theme\\s*=\\s*['"]?${scheme}['"]?\\s*\\]`).test(css),
  )

  if (found.length) return [...found]
  return [/color-scheme\s*:\s*light/.test(css) ? 'light' : 'dark']
}

class Themes {
  id = $state<string>(SYSTEM)
  accent = $state<string>(DEFAULT_ACCENT)
  files = $state<ThemeInfo[]>([])
  /** What the system currently prefers. Kept up to date, so following it
   *  means following it through the day and not only at launch. */
  private preferred = $state<Scheme>('dark')
  /** Which side of a theme that states both, once something has said. Null
   *  follows the system, the same as the built-in choice does. A choice like
   *  the theme itself, so it is held the same way. */
  side = $state<Scheme | null>(null)

  readonly accents = ACCENTS

  /** The choice at the top is to follow the system; the rest are themes. A
   *  theme file that states both schemes is shown as whichever it is showing,
   *  so the accent and the system bars are read off the right one. */
  readonly all = $derived<ThemeInfo[]>([
    { id: SYSTEM, name: 'Match the system', scheme: this.preferred, variants: [this.preferred] },
    ...BUILT_IN,
    ...this.files.map((file) =>
      file.variants.length > 1 ? { ...file, scheme: this.side ?? this.preferred } : file,
    ),
  ])
  readonly active = $derived.by((): ThemeInfo => {
    if (this.id === SYSTEM) return BY_SCHEME[this.preferred]
    return this.all.find((theme) => theme.id === this.id) ?? BY_SCHEME.dark
  })
  readonly current = $derived(this.active.scheme)

  /** What the store has put in the folder, by the id the registry knows it
   *  under, so the gallery can mark a card installed and offer an update. */
  readonly installed = $derived(
    new Map(this.files.flatMap((file) => (file.stamp ? [[file.stamp.id, file] as const] : []))),
  )

  init() {
    const light = window.matchMedia(LIGHT)
    this.preferred = light.matches ? 'light' : 'dark'
    light.addEventListener('change', (event) => {
      this.preferred = event.matches ? 'light' : 'dark'
      if (this.id === SYSTEM) this.apply()
    })

    const saved = localStorage.getItem(STORAGE_KEY)
    this.id = saved && saved !== 'null' ? saved : SYSTEM
    const side = localStorage.getItem(SIDE_KEY)
    this.side = side === 'light' || side === 'dark' ? side : null
    this.accent = localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT
    this.apply()
    void this.reload()
  }

  /** Rescans the themes folder, so dropping in a file needs no restart, and so
   *  installing one from the store shows up without one either. Read in
   *  parallel: this runs at launch, and the files are small. */
  async reload() {
    try {
      const found = await invoke<ThemeFile[]>('list_themes')
      const sheets = await Promise.all(
        found.map((file) => invoke<string>('read_theme', { path: file.path }).catch(() => '')),
      )

      this.files = found.map((file, at): ThemeInfo => {
        const css = sheets[at] ?? ''
        const stamp = stampOf(css)
        const variants = variantsOf(css)

        return {
          ...file,
          // The store's own name for it, which is spelled the way its author
          // spelled it rather than worked out from the file name.
          ...(stamp ? { name: stamp.name, stamp } : {}),
          variants,
          ownAccent: /--accent\s*:/.test(css),
          scheme: variants[0] ?? 'dark',
        }
      })
    } catch {
      this.files = []
    }

    // A theme file may have been deleted while it was selected.
    if (!this.all.some((theme) => theme.id === this.id)) this.select(SYSTEM)
    // Otherwise applied again now that the folder has been read: at launch the
    // theme was chosen before the files were known, so a file theme had nothing
    // to apply and its accent was nobody's yet.
    else this.apply()

    await this.loadCustom()
  }

  /** `custom.css` applies on top of whichever theme is active. */
  private async loadCustom() {
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
    // Read before the choice changes: what the app is showing right now, or
    // nothing at all for somebody who is following the system.
    const was = this.id === SYSTEM ? null : this.current

    this.id = id
    // A theme that states both schemes opens on the side the app was already
    // on. Choosing a theme is not a request to change the light, and taking the
    // system's preference here would turn one explicit choice into an implicit
    // one. Somebody who was following the system goes on following it.
    if (was && !this.side && this.active.variants.length > 1) this.setSide(was)

    this.apply()
    localStorage.setItem(STORAGE_KEY, id)
  }

  private setSide(scheme: Scheme) {
    this.side = scheme
    localStorage.setItem(SIDE_KEY, scheme)
  }

  setAccent(id: string) {
    this.accent = id
    localStorage.setItem(ACCENT_KEY, id)
    this.paintAccent()
  }

  /** Whether the accent belongs to the theme rather than to the reader. What
   *  makes the row of swatches worth showing. */
  readonly accentIsTheme = $derived(this.active.ownAccent === true)

  /** Written straight onto the root element, so it sits above whatever theme is
   *  underneath, including one loaded from a file.
   *
   *  Except where the theme brought an accent of its own, which is the one thing
   *  that outranks the reader's colour: a theme is chosen from a picture of it,
   *  and repainting a third of that picture afterwards would make the picture a
   *  lie. Taken off first either way, so the theme underneath is uncovered
   *  rather than left with yesterday's colour written over it. */
  private paintAccent() {
    const style = document.documentElement.style
    const tokens = accentTokens(this.accent, this.current)

    for (const token of Object.keys(tokens)) style.removeProperty(token)
    if (this.accentIsTheme) return

    for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
  }

  /** The rail's one-click switch: jump to the counterpart scheme. An explicit
   *  choice, so it stops following the system until that is chosen again.
   *
   *  A theme that states both schemes is switched inside itself rather than
   *  swapped for a built-in: somebody using a pair asked for that theme's dark,
   *  not for ours. */
  toggle() {
    const wanted: Scheme = this.current === 'dark' ? 'light' : 'dark'

    if (this.active.variants.length > 1) {
      this.setSide(wanted)
      this.apply()
      return
    }

    this.select(BY_SCHEME[wanted].id)
  }

  private apply() {
    const theme = this.active
    // Built-in tokens still provide the base, so a file theme only overrides
    // what it cares about.
    document.documentElement.dataset.theme = theme.path ? theme.scheme : theme.id
    this.paintAccent()
    this.paintSystemBars()

    if (!theme.path) {
      this.inject('')
      return
    }

    // A theme file that has gone away leaves the built-in tokens showing,
    // which is what the data attribute above has already set up.
    void invoke<string>('read_theme', { path: theme.path })
      .then((css) => this.inject(css))
      .catch(() => this.inject(''))
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
