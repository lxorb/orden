import { ACCENTS, accentTokens, DEFAULT_ACCENT } from './accents'
import { tintSystemBars } from './insets'
import { invoke } from './tauri'
import { type Stamp, stampOf } from './themes/validate'

export type Scheme = 'dark' | 'light'

/** What a reader may ask the app to be: either scheme by name, or whatever the
 *  system is asking for at the time. */
export type SchemeChoice = Scheme | 'system'

/** The three the control offers, in the order it draws them. Following the
 *  system first, because it is where everybody starts. */
export const SCHEME_CHOICES: SchemeChoice[] = ['system', 'dark', 'light']

/** What each is called. Named here rather than at the control, so the pane, the
 *  palette and anything else that offers the choice say the same word. */
export const SCHEME_NAMES: Record<SchemeChoice, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
}

interface ThemeInfo {
  id: string
  name: string
  /** Which schemes the theme states. The built-in states both; a theme file
   *  states whatever its author wrote, which may be one of them. */
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
/** Which scheme was asked for. Its own key, because it is its own choice: a
 *  theme has a dark side or a light one or both, and which of them the app is
 *  showing is not what theme it is. */
const SCHEME_KEY = 'nib:theme-scheme'
/** Where the side of a theme that stated both was kept, before the scheme was a
 *  choice of its own. Read once, by the migration, and never written. */
const SIDE_KEY = 'nib:theme-side'
const STYLE_ID = 'nib-user-theme'
const CUSTOM_ID = 'nib-custom-css'

const ACCENT_KEY = 'nib:accent'

/** The one built-in theme: the app's own tokens, which state both schemes.
 *
 *  There was a Dark and a Light in this list, and they were the same theme twice
 *  with the scheme baked into each. Choosing a look and choosing whether the room
 *  is dark are two questions, and a dropdown that mixed them could not offer a
 *  theme that has both sides without offering it twice. So the built-in is one
 *  theme with two sides, and the scheme is chosen beside it. */
const DEFAULT_ID = 'default'
const DEFAULT_THEME: ThemeInfo = {
  id: DEFAULT_ID,
  name: 'Default',
  variants: ['dark', 'light'],
}

const LIGHT = '(prefers-color-scheme: light)'

/** The line the store writes on the front of a theme it installs. Taken off
 *  before the file is read for what it sets: what it says is a name, not CSS. */
const STAMP_LINE = /^\s*\/\*!\s*nib-theme\s*\{.*?\}\s*\*\//

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

function isChoice(value: unknown): value is SchemeChoice {
  return isScheme(value) || value === 'system'
}

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
  id = $state<string>(DEFAULT_ID)
  /** Which scheme was asked for, which is a choice and not a theme. `system`
   *  follows the media query through the day rather than only at launch. */
  scheme = $state<SchemeChoice>('system')
  accent = $state<string>(DEFAULT_ACCENT)
  files = $state<ThemeInfo[]>([])
  /** What the system currently prefers. */
  private preferred = $state<Scheme>('dark')

  readonly accents = ACCENTS

  /** The built-in first, then what is installed, in the order the folder gave
   *  them - both platforms list a folder by name, so the order is the same on
   *  every machine and does not move as themes are used. */
  readonly all = $derived<ThemeInfo[]>([DEFAULT_THEME, ...this.files])

  readonly active = $derived(this.all.find((one) => one.id === this.id) ?? DEFAULT_THEME)

  /** The scheme that was asked for, by name or through the system. */
  readonly wanted = $derived<Scheme>(this.scheme === 'system' ? this.preferred : this.scheme)

  /** The scheme the app is actually in: the one asked for, or the one the theme
   *  in force has where it does not have that one. A theme with a single scheme
   *  is that scheme and never half of one, and a reader asking a light-only theme
   *  for its dark is not handed ours instead. */
  readonly current = $derived<Scheme>(
    this.active.variants.includes(this.wanted)
      ? this.wanted
      : (this.active.variants[0] ?? this.wanted),
  )

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
      if (this.scheme === 'system') this.apply()
    })

    this.restoreChoice()
    this.accent = localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT
    this.apply()
    void this.reload()
  }

  /** What was chosen, in whichever version's spelling.
   *
   *  `dark`, `light` and `system` were themes in the dropdown before the scheme
   *  became a choice beside the theme. Each of them means the built-in theme and
   *  a scheme, so that is what they are read as. The side of a theme that stated
   *  both was already this choice under another name, so it is taken as the
   *  scheme where the theme is a file.
   *
   *  Written back in the new spelling at once, so nothing further along has to
   *  know there was an old one. */
  private restoreChoice() {
    const saved = localStorage.getItem(STORAGE_KEY) ?? ''
    const chosen = localStorage.getItem(SCHEME_KEY)
    const side = localStorage.getItem(SIDE_KEY)

    this.scheme = isChoice(chosen)
      ? chosen
      : isChoice(saved)
        ? saved
        : isScheme(side)
          ? side
          : 'system'

    this.id = !saved || saved === 'null' || isChoice(saved) ? DEFAULT_ID : saved

    localStorage.setItem(STORAGE_KEY, this.id)
    localStorage.setItem(SCHEME_KEY, this.scheme)
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
        const whole = sheets[at] ?? ''
        const stamp = stampOf(whole)
        // Read past the stamp: it holds a name out of the catalogue, and a theme
        // called `--accent:` would otherwise be read as one that brings its own.
        const css = whole.replace(STAMP_LINE, '')

        return {
          ...file,
          // The store's own name for it, which is spelled the way its author
          // spelled it rather than worked out from the file name.
          ...(stamp ? { name: stamp.name, stamp } : {}),
          variants: variantsOf(css),
          ownAccent: /--accent\s*:/.test(css),
        }
      })
    } catch {
      this.files = []
    }

    // A theme file may have been deleted while it was selected.
    if (!this.all.some((theme) => theme.id === this.id)) this.select(DEFAULT_ID)
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

  /** Chooses the theme, and only the theme. The scheme is left exactly as it
   *  was: a theme with one side shows that side without the choice changing, so
   *  going back to a theme that has both comes back to what was asked for. */
  select(id: string) {
    this.id = id
    this.apply()
    localStorage.setItem(STORAGE_KEY, id)
  }

  /** Whether the light and dark switch has anywhere to go, which is what makes
   *  it a switch rather than a button that throws a theme away.
   *
   *  The app's own tokens state both schemes, so the built-in is one pair and the
   *  switch is live on it. A theme file is whatever it said it was: one that
   *  states both is switched inside itself, and one that states a single scheme
   *  has no other side to show. */
  readonly switchable = $derived(this.active.variants.length > 1)

  /** Whether the theme in force can be shown that way.
   *
   *  A theme that states one scheme has no other side, and following the system
   *  would ask it for the side it does not have half the time. So on such a theme
   *  only its own scheme is offered; every control that chooses the scheme reads
   *  this and disables what it cannot honour. */
  offers(choice: SchemeChoice): boolean {
    return this.switchable || choice === this.current
  }

  /** Which of the three a control points at. The choice itself, unless the theme
   *  cannot be shown that way, in which case the scheme it does have: a control
   *  pointing at a scheme the theme lacks would be saying something untrue. */
  readonly shown = $derived<SchemeChoice>(this.switchable ? this.scheme : this.current)

  setScheme(choice: SchemeChoice) {
    if (!this.offers(choice)) return

    this.scheme = choice
    localStorage.setItem(SCHEME_KEY, choice)
    this.apply()
  }

  /** The rail's one-click switch: jump to the counterpart scheme. An explicit
   *  choice, so it stops following the system until that is chosen again. */
  toggle() {
    if (!this.switchable) return

    this.setScheme(this.current === 'dark' ? 'light' : 'dark')
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

  /** Which application is the latest. Reading a theme file is a round trip, and
   *  installing one asks for two of them a moment apart: the rescan applies what
   *  is still the old theme, and choosing the new one applies that. Whichever
   *  read finishes last would otherwise decide, which is how the window ends up
   *  wearing one theme's stylesheet under another theme's tokens. */
  private applied = 0

  private apply() {
    const theme = this.active
    const applying = ++this.applied

    // The scheme decides the tokens, whichever theme sits on top of them: the
    // built-in states both, and a theme file only overrides what it cares about.
    document.documentElement.dataset.theme = this.current
    this.paintAccent()
    this.paintSystemBars()

    if (!theme.path) {
      this.inject('')
      return
    }

    // A theme file that has gone away leaves the built-in tokens showing,
    // which is what the data attribute above has already set up.
    void invoke<string>('read_theme', { path: theme.path })
      .then((css) => this.inject(applying === this.applied ? css : null))
      .catch(() => this.inject(applying === this.applied ? '' : null))
  }

  /** The bars the system draws over the page: its clock and battery at the top,
   *  its gesture bar at the bottom. A browser and an installed web app tint
   *  them from the meta tag; the Android app draws under them and is asked
   *  instead which way round the icons go, since nothing in CSS reaches those.
   *  Either way the difference is an app that ends at the page and one that
   *  does not. */
  private paintSystemBars() {
    const tag = document.querySelector('meta[name="theme-color"]')
    if (tag) {
      // Read back rather than guessed: a theme file may have replaced --bg.
      const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      if (background) tag.setAttribute('content', background)
    }

    tintSystemBars(this.current === 'dark')
  }

  /** Puts the active theme's stylesheet on the page. Null is an answer that
   *  arrived after a newer one: nothing to do, and above all not to be applied. */
  private inject(css: string | null) {
    if (css === null) return

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
