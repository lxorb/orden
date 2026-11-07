import { contrastCss } from '@orden/themes/contrast'
import { everySurface } from '@orden/themes/write'
import { ACCENTS, accentSetting, DEFAULT_ACCENT } from './accents'
import { tintSystemBars } from './insets'
import { log } from './log'
import { startup } from './startup.svelte'
import { without } from './records'
import { chrome } from './glass/chrome.svelte'
import { groundUnknown, rememberGround, standAsBefore, stoodOnNothing } from './ground'
import {
  forget,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  keep,
  keepJson,
  recordOf,
  stored,
  storedText,
} from './stored'
import { invoke, isDesktop, platform } from './tauri'
import {
  type ChosenSettings,
  declares,
  paintOf,
  paintsOver,
  SETTINGS_KEY,
  SHARED,
  type ThemeSetting,
  type ThemeValue,
  valueOf,
} from './themes/settings'
import { carriedCss } from './themes/carried'
import { type Stamp, STAMP_LINE, stampOf } from './themes/stamp'

export type Scheme = 'dark' | 'light'

export type SchemeChoice = Scheme | 'system'

interface ThemeInfo {
  id: string
  name: string
  variants: Scheme[]
  path?: string
  css?: string
  load?: () => Promise<string>
  translucent?: boolean
  pictured?: boolean
  own?: () => Promise<() => ThemeSetting[]>
  stamp?: Stamp
}

interface ThemeFile {
  id: string
  name: string
  path: string
}

const STORAGE_KEY = 'orden:theme'
const SCHEME_KEY = 'orden:theme-scheme'
const STYLE_ID = 'orden-user-theme'
const CUSTOM_ID = 'orden-custom-css'

const ACCENT_KEY = 'orden:accent'
const SHEET_KEY = 'orden:theme-sheet'
const OFFERED_KEY = 'orden:contrast-offered'
const CONTRAST_THEME = 'contrast'

const DEFAULT_ID = 'default'
const DEFAULT_THEME: ThemeInfo = {
  id: DEFAULT_ID,
  name: 'Classic',
  variants: ['dark', 'light'],
}

const CONTRAST: ThemeInfo = {
  id: CONTRAST_THEME,
  name: 'Contrast',
  variants: ['dark', 'light'],
  css: contrastCss,
}

const GLASS_THEME = 'glass'

export function chosenFirst(css: string): string {
  const head = (place: string) => `var(--font-${place}-chosen,) `
  const stacks = css.replace(
    /(--font-(ui|content|mono)\s*:\s*)(?![\s]|var\(--font-)/g,
    (_whole, said: string, place: string) => said + head(place),
  )
  return stacks.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector: string, body: string) => {
    if (!/font-family\s*:/.test(body)) return whole
    const place = /\b(code|pre|kbd|samp)\b/.test(selector) ? 'mono' : 'content'
    const fixed = body.replace(
      /(font-family\s*:\s*)(?![\s]|var\(--font-)/g,
      (_said, said: string) => said + head(place),
    )
    return `${selector}{${fixed}}`
  })
}

function hasMaterial(): boolean {
  return isDesktop && platform() === 'windows'
}

const GLASS: ThemeInfo = {
  id: GLASS_THEME,
  name: 'Glass',
  variants: ['dark', 'light'],
  translucent: true,
  load: () => import('@orden/themes/glass').then((module) => module.glassCss),
  own: () => import('./glass/settings').then((module) => module.glassSettings),
}

const FIRST_LOOK = __EVEN_PLUGIN__ ? null : { theme: GLASS_THEME, accent: 'green' }
const GIVEN_KEY = 'orden:accent-given'
const GIVEN_BEFORE = 'yellow'
const MOVED_KEY = 'orden:theme-moved'

const WALLPAPER: ThemeInfo = {
  id: 'wallpaper',
  name: 'Wallpaper',
  variants: ['dark', 'light'],
  pictured: true,
  load: () => import('./wallpaper/sheet').then((module) => module.wallpaperSheet()),
  own: () => import('./wallpaper/settings').then((module) => module.wallpaperSettings),
}

export function isBuiltIn(id: string): boolean {
  return builtIns().some((one) => one.id === id)
}

export function builtIns(): ThemeInfo[] {
  return [DEFAULT_THEME, CONTRAST, GLASS, WALLPAPER]
}

const LIGHT = '(prefers-color-scheme: light)'
const MORE = '(prefers-contrast: more)'

export function appSettings(): ThemeSetting[] {
  return [accentSetting()]
}

function isValue(one: unknown): one is ThemeValue {
  return isString(one) || isNumber(one) || isBoolean(one)
}

function earlySheet(): { id: string; css: string } | null {
  const held = stored(SHEET_KEY)
  if (!isRecord(held) || typeof held.id !== 'string' || typeof held.css !== 'string') return null
  return { id: held.id, css: held.css }
}

const copiesBuiltIn = (file: ThemeInfo) => file.stamp !== undefined && isBuiltIn(file.stamp.id)

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

function isChoice(value: unknown): value is SchemeChoice {
  return isScheme(value) || value === 'system'
}

function variantsOf(css: string): Scheme[] {
  const found = (['light', 'dark'] as const).filter((scheme) =>
    new RegExp(`\\[data-theme\\s*=\\s*['"]?${scheme}['"]?\\s*\\]`).test(css),
  )

  if (found.length) return [...found]
  return [/color-scheme\s*:\s*light/.test(css) ? 'light' : 'dark']
}

class Themes {
  id = $state<string>(DEFAULT_ID)
  scheme = $state<SchemeChoice>('system')
  private chosen = $state<ChosenSettings>({})
  private trying = $state<Record<string, ThemeValue>>({})
  private sheet = $state('')
  private declared = $state<ThemeSetting[]>([])
  private owned = $state<{ id: string; list: () => ThemeSetting[] } | null>(null)
  private loaded = $state<Record<string, string>>({})
  private material = false
  files = $state<ThemeInfo[]>([])
  private preferred = $state<Scheme>('dark')
  offerContrast = $state(false)

  readonly accents = ACCENTS

  private readonly fromFolder = $derived(this.files.filter((file) => !copiesBuiltIn(file)))

  readonly all = $derived<ThemeInfo[]>([
    DEFAULT_THEME,
    CONTRAST,
    ...(__EVEN_PLUGIN__ ? [] : [this.withLoaded(GLASS)]),
    ...(__EVEN_PLUGIN__ ? [] : [this.withLoaded(WALLPAPER)]),
    ...this.fromFolder,
  ])

  readonly active = $derived(this.all.find((one) => one.id === this.id) ?? DEFAULT_THEME)

  readonly wanted = $derived<Scheme>(this.scheme === 'system' ? this.preferred : this.scheme)

  readonly current = $derived<Scheme>(
    this.active.variants.includes(this.wanted)
      ? this.wanted
      : (this.active.variants[0] ?? this.wanted),
  )

  readonly installed = $derived(
    new Map(
      this.fromFolder.flatMap((file) => (file.stamp ? [[file.stamp.id, file] as const] : [])),
    ),
  )

  init() {
    const light = window.matchMedia(LIGHT)
    this.preferred = light.matches ? 'light' : 'dark'
    light.addEventListener('change', (event) => {
      this.preferred = event.matches ? 'light' : 'dark'
      if (this.scheme === 'system') this.apply()
    })

    const unwritten = storedText(STORAGE_KEY) === null
    const first = this.restoreChoice()
    this.offerTheContrastTheme()
    this.restoreSettings(first, unwritten)
    this.early = earlySheet()
    if (this.active.translucent === true) standAsBefore()
    this.material = stoodOnNothing() || groundUnknown()
    this.apply()
    void this.reload()
  }

  private withLoaded(theme: ThemeInfo): ThemeInfo {
    const css = this.loaded[theme.id]
    return css === undefined ? theme : { ...theme, css }
  }

  warm() {
    for (const theme of this.all) {
      if (theme.css === undefined && theme.load) void this.fetched(theme).catch(() => undefined)
    }
  }

  private async fetched(theme: ThemeInfo): Promise<string> {
    const held = this.loaded[theme.id]
    if (held !== undefined || !theme.load) return held ?? ''

    const css = await theme.load()
    this.loaded = { ...this.loaded, [theme.id]: css }
    return css
  }

  private restoreSettings(first: boolean, unwritten: boolean) {
    const drawers: ChosenSettings = Object.fromEntries(
      Object.entries(recordOf(stored(SETTINGS_KEY), isRecord)).map(([owner, values]) => [
        owner,
        recordOf(values, isValue),
      ]),
    )

    const app = drawers[SHARED]
    if (app) {
      const own = new Set(appSettings().map((one) => one.id))
      const kept = Object.fromEntries(Object.entries(app).filter(([id]) => own.has(id)))
      if (Object.keys(kept).length !== Object.keys(app).length) {
        drawers[SHARED] = kept
        keepJson(SETTINGS_KEY, drawers)
      }
    }

    const accent = storedText(ACCENT_KEY)
    if (accent !== null && drawers[SHARED]?.accent === undefined) {
      drawers[SHARED] = { ...drawers[SHARED], accent }
    }

    this.giveAccent(drawers, first, unwritten)
    this.chosen = drawers
    this.trying = {}
  }

  private giveAccent(drawers: ChosenSettings, first: boolean, unwritten: boolean) {
    if (!FIRST_LOOK) return

    const held = drawers[SHARED]?.accent
    const given =
      storedText(GIVEN_KEY) ?? (unwritten && storedText(ACCENT_KEY) === null ? GIVEN_BEFORE : '')
    const stillGiven = held === undefined ? first : held === given

    if (stillGiven && held !== FIRST_LOOK.accent) {
      drawers[SHARED] = { ...drawers[SHARED], accent: FIRST_LOOK.accent }
      keepJson(SETTINGS_KEY, drawers)
    }
    keep(GIVEN_KEY, stillGiven ? FIRST_LOOK.accent : '')
  }

  private chose(): boolean {
    return storedText(STORAGE_KEY) !== null && this.id !== DEFAULT_ID
  }

  adoptTranslucency() {
    if (this.id === DEFAULT_ID && !__EVEN_PLUGIN__ && hasMaterial()) this.select(GLASS_THEME)
  }

  private restoreChoice(): boolean {
    const saved = storedText(STORAGE_KEY)
    const chosen = storedText(SCHEME_KEY)
    const id = !saved || saved === 'null' || isChoice(saved) ? DEFAULT_ID : saved
    const moved = saved && storedText(MOVED_KEY)

    this.scheme = isChoice(chosen) ? chosen : isChoice(saved) ? saved : 'system'
    keep(SCHEME_KEY, this.scheme)
    keep(MOVED_KEY, 'yes')

    if (FIRST_LOOK && id === DEFAULT_ID && !moved) {
      this.id = FIRST_LOOK.theme
      forget(STORAGE_KEY)
      return true
    }

    this.id = id
    keep(STORAGE_KEY, this.id)
    return false
  }

  private offerTheContrastTheme() {
    if (storedText(OFFERED_KEY)) return

    if (!window.matchMedia(MORE).matches) return

    if (this.chose()) {
      keep(OFFERED_KEY, 'yes')
      return
    }

    keep(OFFERED_KEY, 'yes')
    this.offerContrast = true
    this.select(CONTRAST_THEME)
  }

  async reload() {
    let found: ThemeFile[]

    try {
      found = await invoke<ThemeFile[]>('list_themes')
    } catch (error) {
      log('warn', `themes: could not list the folder: ${String(error)}`)
      await this.loadCustom()
      return
    }

    const sheets = await Promise.all(
      found.map((file) =>
        invoke<string>('read_theme', { path: file.path })
          .then(carriedCss)
          .catch(() => ''),
      ),
    )

    const held = this.files
    this.files = found.map((file, at): ThemeInfo => {
      const whole = sheets[at] ?? ''

      const before = whole ? undefined : held.find((one) => one.path === file.path)
      if (before) return before

      const stamp = stampOf(whole)
      const css = whole.replace(STAMP_LINE, '')

      return {
        ...file,
        ...(stamp ? { name: stamp.name, stamp } : {}),
        variants: variantsOf(css),
        ...(css.includes('[data-translucent]') ? { translucent: true } : {}),
        ...(whole ? { css } : {}),
      }
    })

    const copy = this.files.find((file) => file.id === this.id && copiesBuiltIn(file))
    if (copy?.stamp) this.select(copy.stamp.id)
    else if (!this.all.some((theme) => theme.id === this.id)) this.select(DEFAULT_ID)
    else this.apply()

    await this.loadCustom()
  }

  private async loadCustom() {
    const css = await invoke<string>('read_custom_css')
      .then(carriedCss)
      .catch(() => '')
    let style = document.getElementById(CUSTOM_ID)

    if (!css.trim()) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = CUSTOM_ID
      document.head.append(style)
    }
    style.textContent = everySurface(css)
  }

  select(id: string) {
    this.id = id
    this.apply()
    keep(STORAGE_KEY, id)
  }

  preview(id: string, scheme: SchemeChoice, accent: string) {
    const tried = Object.keys(this.trying)
    if (
      this.id === id &&
      this.scheme === scheme &&
      tried.length === 1 &&
      this.trying.accent === accent
    )
      return
    this.id = id
    this.scheme = scheme
    this.trying = { accent }
    this.apply(false)
  }

  readonly switchable = $derived(this.active.variants.length > 1)

  offers(choice: SchemeChoice): boolean {
    return this.switchable || choice === this.current
  }

  readonly shown = $derived<SchemeChoice>(this.switchable ? this.scheme : this.current)

  setScheme(choice: SchemeChoice) {
    if (!this.offers(choice)) return

    this.scheme = choice
    keep(SCHEME_KEY, choice)
    this.apply()
  }

  toggle() {
    if (!this.switchable) return

    this.setScheme(this.current === 'dark' ? 'light' : 'dark')
  }

  readonly settings = $derived<ThemeSetting[]>([
    ...appSettings().filter((one) => !paintsOver(this.sheet, one)),
    ...(this.owned?.id === this.id ? this.owned.list() : []),
    ...this.declared,
  ])

  private drawerOf(setting: ThemeSetting): string {
    return setting.shared === true ? SHARED : this.id
  }

  readonly values = $derived<Record<string, ThemeValue>>(
    Object.fromEntries(
      this.settings.map((one) => [
        one.id,
        valueOf(one, this.trying[one.id] ?? this.chosen[this.drawerOf(one)]?.[one.id]),
      ]),
    ),
  )

  keptFor(owner: string, id: string): ThemeValue | undefined {
    return this.chosen[owner]?.[id]
  }

  setFor(drawer: string, id: string, value: ThemeValue) {
    if (drawer === this.id || drawer === SHARED) {
      const setting = this.settings.find((one) => one.id === id)
      if (setting && this.drawerOf(setting) === drawer) {
        this.set(id, value)
        return
      }
    }
    this.chosen = { ...this.chosen, [drawer]: { ...this.chosen[drawer], [id]: value } }
    keepJson(SETTINGS_KEY, this.chosen)
  }

  set(id: string, value: ThemeValue) {
    const setting = this.settings.find((one) => one.id === id)
    if (!setting) return

    const drawer = this.drawerOf(setting)
    this.chosen = { ...this.chosen, [drawer]: { ...this.chosen[drawer], [id]: value } }
    this.trying = Object.fromEntries(Object.entries(this.trying).filter(([one]) => one !== id))
    keepJson(SETTINGS_KEY, this.chosen)
    if (id === 'accent') keep(GIVEN_KEY, '')
    this.paintSettings()
    if (setting.reapplies === true) this.apply()
  }

  get previewing(): boolean {
    return Object.entries(this.trying).some(([id, value]) => {
      const setting = this.settings.find((one) => one.id === id)
      if (!setting) return false
      return valueOf(setting, value) !== valueOf(setting, this.chosen[this.drawerOf(setting)]?.[id])
    })
  }

  try(id: string, value: ThemeValue) {
    if (this.trying[id] === value) return
    this.trying = { ...this.trying, [id]: value }
    this.paintSettings()
  }

  readonly accent = $derived<string>(String(this.values.accent ?? DEFAULT_ACCENT))

  readonly accentIsTheme = $derived(!this.settings.some((one) => one.id === 'accent'))

  setAccent(id: string) {
    this.set('accent', id)
  }

  private painted: string[] = []

  private paintSettings() {
    const style = document.documentElement.style
    for (const token of this.painted) style.removeProperty(token)

    const tokens = paintOf(this.settings, this.values, this.current)
    for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
    this.painted = Object.keys(tokens)
  }

  private applied = 0

  private wearing = ''

  rewear(id: string, kept = true) {
    this.loaded = without(this.loaded, id)
    if (this.id === id) this.apply(kept)
  }

  private early: { id: string; css: string } | null = null

  private apply(kept = true) {
    const theme = this.active
    const applying = ++this.applied

    document.documentElement.dataset.theme = this.current

    const early = this.early?.id === theme.id ? this.early.css : undefined
    this.early = null

    if (theme.css !== undefined) this.wear(theme.css, kept)
    else if (theme.load) {
      if (early !== undefined) this.wear(early, false)
      void this.fetched(theme)
        .then(carriedCss)
        .then((css) => this.wear(applying === this.applied ? css : null, kept))
        .catch(() => this.wear(applying === this.applied ? '' : null, kept))
    } else if (!theme.path) this.wear('', kept)
    else {
      if (early !== undefined) this.wear(early, false)
      void invoke<string>('read_theme', { path: theme.path })
        .then(carriedCss)
        .then((css) => this.wear(applying === this.applied ? css : null, kept))
        .catch(() => this.wear(applying === this.applied ? '' : null, kept))
    }

    if (!__EVEN_PLUGIN__ && theme.pictured === true) this.wakeWallpaper()

    if (!__EVEN_PLUGIN__) this.followWhatIsOpen(theme.id === GLASS_THEME, kept)

    const translucent = theme.translucent === true
    if (!__EVEN_PLUGIN__ && isDesktop && (translucent || this.material)) {
      this.material = true
      const dark = this.current === 'dark'
      const kind = theme.path ? 'clear' : this.materialAsked()
      void import('./material').then(({ wearMaterial }) =>
        wearMaterial(translucent, dark, kept, kind),
      )
    }

    this.paintSystemBars()
    if (kept) rememberGround()
  }

  private woken = false

  private wakeWallpaper() {
    if (this.woken) return
    this.woken = true
    void startup
      .turn('doors')
      .then(() => import('./wallpaper/wallpaper.svelte'))
      .then(({ wallpaper }) => (this.active.pictured === true ? wallpaper.wake() : undefined))
  }

  private materialAsked(): string {
    const said = this.values.material ?? this.keptFor(GLASS_THEME, 'material')
    return typeof said === 'string' ? said : 'mica-alt'
  }

  private followWhatIsOpen(glass: boolean, kept: boolean) {
    if (!glass) {
      chrome.sleep()
      if (kept) chrome.forget()
      return
    }

    chrome.wake(this.current)
    void import('./glass/follow.svelte').then((one) => one.follow())
  }

  private wear(css: string | null, kept: boolean) {
    if (css === null) return

    this.inject(css)
    if (isDesktop) void invoke('wear_page_styles', { css }).catch(() => undefined)
    const sheet = css.replace(STAMP_LINE, '')
    if (sheet !== this.sheet && (this.wearing !== this.id || !declares(sheet))) this.declared = []
    this.wearing = this.id
    this.sheet = sheet
    this.paintSettings()
    this.paintSystemBars()
    if (kept) this.keepSheet(css)

    if (declares(sheet)) void this.readDeclarations(sheet)
    if (this.active.own && this.owned?.id !== this.id) void this.readOwn(this.active)
  }

  private async readOwn(theme: ThemeInfo) {
    if (__EVEN_PLUGIN__ || !theme.own) return
    const list = await theme.own().catch(() => null)
    if (!list || this.id !== theme.id) return
    this.owned = { id: theme.id, list }
    this.paintSettings()
  }

  private keepSheet(css: string) {
    if (__EVEN_PLUGIN__) return
    const theme = this.active
    if (theme.load === undefined && theme.path === undefined) {
      forget(SHEET_KEY)
      return
    }

    if (earlySheet()?.css !== css) keepJson(SHEET_KEY, { id: theme.id, css })
  }

  private async readDeclarations(css: string) {
    if (__EVEN_PLUGIN__) return
    const applying = this.applied
    const { declaredIn, readProperty } = await import('./themes/declared')
    if (applying !== this.applied || css !== this.sheet) return

    this.declared = declaredIn(css, readProperty)
    this.paintSettings()
  }

  private paintSystemBars() {
    const tag = document.querySelector('meta[name="theme-color"]')
    if (tag) {
      const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      if (background) tag.setAttribute('content', background)
    }

    tintSystemBars(this.current === 'dark')
    this.paintWindow()
  }

  private toldWindow: Scheme | null | undefined = undefined

  private paintWindow() {
    if (!isDesktop || platform() !== 'macos') return

    const told = this.scheme === 'system' ? null : this.current
    if (told === this.toldWindow) return
    this.toldWindow = told

    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(told))
      .catch((error: unknown) => {
        log('warn', `window appearance: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

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
      document.head.insertBefore(style, document.getElementById(CUSTOM_ID))
    }
    style.textContent = everySurface(chosenFirst(css))
  }
}

export const theme = new Themes()
