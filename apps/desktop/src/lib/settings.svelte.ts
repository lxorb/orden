import type { SettingsSectionId } from '@orden/contracts'
import { setSnippets } from '@orden/editor'
import { connectors } from './connectors.svelte'
import { DEFAULT_ID_FORMAT, ID_FORMATS } from './note-id'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, type PageSetup, PAPER_SIZES } from './paper'
import {
  isRecord,
  isString,
  keep,
  keepJson,
  stored,
  storedText,
  invoke,
  isNative,
} from './platform/src/api'
import { settingsTab } from './settings-tab'

const PAGE_KEY = 'orden:page'
const APPEARANCE_KEY = 'orden:export-appearance'
const NOTE_ID_KEY = 'orden:note-id'

type ExportAppearance = 'light' | 'dark' | 'app'

export type Section = SettingsSectionId

class Settings {
  section = $state<Section>('general')
  listing = $state(true)
  historyOpen = $state(false)

  pandoc = $state(false)

  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  exportAppearance = $state<ExportAppearance>('light')

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

    void import('./export/src/api')
      .then((one) => one.exporters())
      .then(({ pandocAvailable }) => pandocAvailable().then((found) => (this.pandoc = found)))

    void this.loadSnippets()
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
