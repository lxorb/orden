import { DEFAULT_PAGE_SETUP, ORIENTATIONS, type PageSetup, PAPER_SIZES } from '@orden/contracts'
import { setSnippets } from '@orden/editor'
import { DEFAULT_ID_FORMAT, ID_FORMATS } from './note-id'
import {
  invoke,
  isDesktop,
  isNative,
  isRecord,
  isString,
  keep,
  keepJson,
  stored,
  storedText,
} from '../../platform/src/api'

const PAGE_KEY = 'orden:page'
const APPEARANCE_KEY = 'orden:export-appearance'
const NOTE_ID_KEY = 'orden:note-id'

type ExportAppearance = 'light' | 'dark' | 'app'

class Choices {
  pandoc = $state(false)

  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  exportAppearance = $state<ExportAppearance>('light')

  noteIdFormat = $state(DEFAULT_ID_FORMAT)

  restore() {
    const saved = stored(PAGE_KEY)
    if (isRecord(saved)) {
      this.page = {
        paper: PAPER_SIZES.find((one) => one === saved.paper) ?? DEFAULT_PAGE_SETUP.paper,
        orientation: ORIENTATIONS.find((one) => one === saved.orientation) ?? DEFAULT_PAGE_SETUP.orientation,
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

    if (isDesktop) {
      void invoke<boolean>('has_pandoc')
        .catch(() => false)
        .then((found) => (this.pandoc = found))
    }

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
}

export const choices = new Choices()
