import { setSnippets } from '@orden/editor'
import { account } from './account.svelte'
import { modes } from './modes.svelte'
import { connectors } from './connectors.svelte'
import { message } from './i18n.svelte'
import { DEFAULT_ID_FORMAT, ID_FORMATS } from './note-id'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, type PageSetup, PAPER_SIZES } from './paper'
import { isRecord, isString, keep, keepJson, stored, storedText, stringList } from './stored'
import { invoke, isDesktop, isNative } from './tauri'
import { viewport } from './viewport.svelte'
import { settingsTab } from './settings/tab-hook'

const PAGE_KEY = 'orden:page'
const APPEARANCE_KEY = 'orden:export-appearance'
const NOTE_ID_KEY = 'orden:note-id'

type ExportAppearance = 'light' | 'dark' | 'app'

export type Section =
  | 'general'
  | 'space'
  | 'editor'
  | 'kinds'
  | 'shortcuts'
  | 'mobile'
  | 'spelling'
  | 'markdown'
  | 'appearance'
  | 'glasses'
  | 'experimental'
  | 'ai'
  | 'agents'
  | 'remote'
  | 'online'
  | 'account'
  | 'sync'
  | 'llm'
  | 'trash'
  | 'import'
  | 'export'

class Settings {
  section = $state<Section>('general')
  listing = $state(true)
  historyOpen = $state(false)
  setup = $state<number | null>(null)

  pandoc = $state(false)

  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  exportAppearance = $state<ExportAppearance>('light')

  newMenu = $state(false)

  noteIdFormat = $state(DEFAULT_ID_FORMAT)

  error = $state<string | null>(null)

  restore() {
    connectors.restore()

    const saved = stored(PAGE_KEY)
    if (isRecord(saved)) {
      this.page = {
        paper: PAPER_SIZES.find((one) => one === saved.paper) ?? DEFAULT_PAGE_SETUP.paper,
        orientation:
          ORIENTATIONS.find((one) => one === saved.orientation) ?? DEFAULT_PAGE_SETUP.orientation,
        margin: isString(saved.margin) ? saved.margin : DEFAULT_PAGE_SETUP.margin,
        header: isString(saved.header) ? saved.header : DEFAULT_PAGE_SETUP.header,
        footer: isString(saved.footer) ? saved.footer : DEFAULT_PAGE_SETUP.footer,
      }
    }

    const format = storedText(NOTE_ID_KEY)
    if (format && ID_FORMATS.includes(format)) this.noteIdFormat = format

    const appearance = storedText(APPEARANCE_KEY)
    if (appearance === 'light' || appearance === 'dark' || appearance === 'app') {
      this.exportAppearance = appearance
    }

    void import('./export').then(({ pandocAvailable }) =>
      pandocAvailable().then((found) => (this.pandoc = found)),
    )

    void this.loadSnippets()

    if (isDesktop) {
      void invoke<boolean>('new_menu_registered')
        .then((on) => (this.newMenu = on))
        .catch(() => undefined)
    }
  }

  async setNewMenu(enabled: boolean) {
    if (!isDesktop) return

    this.error = null
    try {
      await invoke('set_new_menu', { enabled })
      this.newMenu = enabled
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  setPage(patch: Partial<PageSetup>) {
    this.page = { ...this.page, ...patch }
    keepJson(PAGE_KEY, this.page)
  }

  setNoteIdFormat(format: string) {
    this.noteIdFormat = format
    keep(NOTE_ID_KEY, format)
  }

  setExportAppearance(appearance: ExportAppearance) {
    this.exportAppearance = appearance
    keep(APPEARANCE_KEY, appearance)
  }

  async loadSnippets() {
    if (!isNative) return

    const raw = await invoke<string>('read_snippets').catch(() => '{}')
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const usable = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>

      setSnippets(usable)
    } catch {
      setSnippets({})
    }
  }

  at = $state<'access' | null>(null)

  space = $state<string | null>(null)
  landsOnField = $state(false)
  asked = $state(0)

  get open(): boolean {
    return settingsTab.seen()
  }

  set open(on: boolean) {
    if (on) settingsTab.reveal()
    else settingsTab.hide()
  }

  show(section?: Section, space: string | null = null, landsOnField = false) {
    if (!landsOnField) this.asked++
    if (section === undefined && space === null && settingsTab.present()) {
      settingsTab.reveal()
      return
    }
    this.space = space
    this.landsOnField = landsOnField
    const moved = section === 'agents' || section === 'llm'
    this.at = moved ? 'access' : null
    this.section = moved ? 'ai' : (section ?? 'general')
    this.listing = section === undefined
    this.error = null
    connectors.freshToken = null
    settingsTab.reveal()
  }
}

export const settings = new Settings()

export const KINDS_KEY = 'orden:hidden-kinds'

export type KindName =
  | 'note'
  | 'canvas'
  | 'pages'
  | 'chat'
  | 'terminal'
  | 'remote'
  | 'online'
  | 'application'
  | 'explorer'
  | 'pass'
  | 'web'
  | 'private'

export function kindsHere(): KindName[] {
  if (__EVEN_PLUGIN__) return ['note', 'canvas', 'pages']

  const web = !viewport.touch
  const here: KindName[] = ['note', 'canvas', 'pages']
  if (account.accountToken && chatsOn()) here.push('chat')
  if (isDesktop && modes.coder) here.push('terminal', 'remote')
  if (modes.coder) here.push('online')
  if (appsOn()) here.push('application')
  if (isDesktop && explorerOn()) here.push('explorer')
  if (passOn()) here.push('pass')
  if (web) here.push('web')
  if (web && isDesktop) here.push('private')
  return here
}

const GATED: readonly KindName[] = ['chat', 'application', 'explorer', 'pass']

export function gated(kind: KindName): boolean {
  return GATED.includes(kind)
}

export function chosenOn(kind: KindName, hidden: readonly string[]): boolean {
  return gated(kind) || !hidden.includes(kind)
}

export function shownOf(here: readonly KindName[], hidden: readonly string[]): KindName[] {
  const shown = here.filter((kind) => chosenOn(kind, hidden))
  return shown.length ? shown : here.slice(0, 1)
}

class HiddenKinds {
  hidden = $state<readonly string[]>([])

  get shown(): KindName[] {
    return shownOf(kindsHere(), this.hidden)
  }

  offers(kind: KindName): boolean {
    return this.shown.includes(kind)
  }

  restore() {
    this.hidden = stringList(stored(KINDS_KEY)) ?? []
  }
}

export const hiddenKinds = new HiddenKinds()

export const EXPERIMENTAL_WORD = 'experimental'

export function experimentalOn(): boolean {
  return hiddenKinds.hidden.includes(EXPERIMENTAL_WORD)
}

function tried(word: string): boolean {
  return experimentalOn() && hiddenKinds.hidden.includes(word)
}

export const CHATS_WORD = 'experimental-chats'
export const APPS_WORD = 'experimental-apps'
export const EXPLORER_WORD = 'experimental-explorer'
export const PASS_WORD = 'experimental-pass'
export const TIME_WORD = 'experimental-time'
export const BASES_WORD = 'experimental-bases'

export function chatsOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(CHATS_WORD)
}

export function appsOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(APPS_WORD)
}

export function explorerOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(EXPLORER_WORD)
}

const passOnly = typeof document !== 'undefined' && document.documentElement.dataset.only === 'pass'

export function passOn(): boolean {
  return !__EVEN_PLUGIN__ && (passOnly || tried(PASS_WORD))
}

export function timeOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(TIME_WORD)
}

export function basesOn(): boolean {
  return tried(BASES_WORD)
}
