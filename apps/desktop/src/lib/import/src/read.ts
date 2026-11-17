import type { FormatId, ImportPlan } from './plan'
import type { Source } from './sources'
import { hasNotionId, looksLikePapers } from './names'
import type { Rows } from './table'

const PEEK = 20

const CLOSED_TAG = /(^|[\s(])#[^\s#`[\]\n](?:[^#`[\]\n]{0,58}[^\s#`[\]\n])?#(?![\w#])/m

const VAULT = /^([^/]+\/)?\.obsidian\//

const ENTRY = /(^|\/)entries\/[^/]+\.html?$/i

const APPLE_HTML = /Cocoa HTML Writer|Apple-converted-space|-apple-system-font/i

const PANDOC = /\.(docx|odt|rtf|epub|rst|textile|tex|opml|org|docbook|fb2)$/i

export async function detect(sources: readonly Source[]): Promise<FormatId | null> {
  if (!sources.length) return null

  const paths = sources.map((one) => one.path)
  const has = (pattern: RegExp) => paths.some((one) => pattern.test(one))

  if (has(VAULT)) return 'obsidian'

  const otherNotes = has(/\.(md|markdown|txt|html?)$/i)
  if (!otherNotes && has(/\.enex$/i)) return 'evernote'
  if (!otherNotes && (await looksLikeTomboy(sources))) return 'tomboy'

  if (looksLikePapers(paths)) return 'pdf-pages'

  const bundle = await bundleWriter(sources)
  if (bundle) return bundle

  if (await looksLikeJournal(sources)) return 'journal'

  if (has(/(^|\/)Keep\/[^/]+\.json$/i)) return 'keep'

  const json = await jsonKind(sources)
  if (json) return json

  if (has(/^([^/]+\/)?logseq\//i) || has(/^([^/]+\/)?pages\//)) return 'logseq'
  if (looksLikeNotion(paths)) return 'notion'

  const markdown = paths.filter((one) => /\.(md|markdown|txt)$/i.test(one))
  const html = paths.filter((one) => /\.html?$/i.test(one))
  const csv = paths.filter((one) => /\.(csv|tsv)$/i.test(one))

  if (csv.length && (await looksLikeTodoist(sources))) return 'todoist'
  if (csv.length && !markdown.length && !html.length) return 'table'

  if (html.length && (await looksLikeOneNote(sources))) return 'onenote'
  if (html.length && (await looksLikeApple(sources))) return 'apple-notes'

  if (markdown.length) return (await looksLikeBear(sources)) ? 'bear' : 'markdown'
  if (html.length) return 'markdown'
  if (has(PANDOC)) return 'pandoc'

  return null
}

function looksLikeNotion(paths: readonly string[]): boolean {
  const named = (path: string) =>
    hasNotionId((path.split('/').pop() ?? path).replace(/_all(\.csv)$/i, '$1'))
  const pages = paths.filter(
    (one) => /\.(md|markdown|html?)$/i.test(one) && !/(^|\/)index\.html$/i.test(one),
  )
  return pages.length ? pages.every(named) : paths.some(named)
}

async function bundleWriter(sources: readonly Source[]): Promise<FormatId | null> {
  const info = sources.find((one) => /\.textbundle\/info\.json$/i.test(one.path))
  if (!info) return null

  const said = (await info.text()).toLowerCase()
  if (said.includes('shinyfrog')) return 'bear'
  if (said.includes('lukilabs')) return 'craft'

  return 'markdown'
}

async function jsonKind(sources: readonly Source[]): Promise<FormatId | null> {
  const jsons = sources.filter((one) => /\.json$/i.test(one.path)).slice(0, PEEK)

  for (const one of jsons) {
    let said: unknown
    try {
      said = JSON.parse(await one.text())
    } catch {
      continue
    }

    if (Array.isArray(said)) {
      const pages: unknown[] = said
      const page = pages.find((entry) => !!entry && typeof entry === 'object')
      if (page && 'title' in page && 'children' in page) return 'roam'
      continue
    }

    if (said && typeof said === 'object') {
      const note = said as Record<string, unknown>
      const keep =
        'textContent' in note ||
        'listContent' in note ||
        'isTrashed' in note ||
        'isArchived' in note
      if (keep) return 'keep'
    }
  }

  return null
}

async function looksLikeBear(sources: readonly Source[]): Promise<boolean> {
  const notes = sources.filter((one) => /\.(md|markdown)$/i.test(one.path)).slice(0, PEEK)

  for (const note of notes) {
    if (CLOSED_TAG.test(await note.text())) return true
  }

  return false
}

async function looksLikeJournal(sources: readonly Source[]): Promise<boolean> {
  const entries = sources.filter((one) => ENTRY.test(one.path)).slice(0, PEEK)
  if (!entries.length) return false

  for (const entry of entries) {
    if (/class="pageHeader"/i.test((await entry.text()).slice(0, 8000))) return true
  }

  const dated = entries.every((one) => /^\d{4}-\d{2}-\d{2}/.test(one.path.split('/').pop() ?? ''))
  return dated && sources.some((one) => /(^|\/)resources\//i.test(one.path))
}

async function looksLikeTomboy(sources: readonly Source[]): Promise<boolean> {
  const notes = sources.filter((one) => /\.note$/i.test(one.path)).slice(0, PEEK)

  for (const note of notes) {
    if (/<note-content[\s>/]/.test((await note.text()).slice(0, 8000))) return true
  }

  return false
}

async function looksLikeApple(sources: readonly Source[]): Promise<boolean> {
  const pages = sources.filter((one) => /\.html?$/i.test(one.path)).slice(0, PEEK)

  for (const page of pages) {
    if (APPLE_HTML.test((await page.text()).slice(0, 4000))) return true
  }

  return false
}

async function looksLikeTodoist(sources: readonly Source[]): Promise<boolean> {
  if (__EVEN_PLUGIN__) return false
  const { isTodoistCsv } = await import('./todoist')
  const tables = sources.filter((one) => /\.csv$/i.test(one.path)).slice(0, PEEK)
  for (const table of tables) if (isTodoistCsv(await table.text())) return true
  return false
}

async function looksLikeOneNote(sources: readonly Source[]): Promise<boolean> {
  const pages = sources.filter((one) => /\.html?$/i.test(one.path)).slice(0, PEEK)

  for (const page of pages) {
    if (/content="Microsoft OneNote/i.test((await page.text()).slice(0, 4000))) return true
  }

  return false
}

export interface ReadOptions {
  rows?: Rows
}

export async function readAs(
  format: FormatId,
  sources: readonly Source[],
  options: ReadOptions = {},
): Promise<ImportPlan> {
  if (__EVEN_PLUGIN__) throw new Error('no import in the Even Realities plugin')

  switch (format) {
    case 'notion': {
      const { readNotion } = await import('./notion')
      return readNotion(sources)
    }
    case 'evernote': {
      const { readEvernote } = await import('./evernote')
      return readEvernote(sources)
    }
    case 'keep': {
      const { readKeep } = await import('./keep')
      return readKeep(sources)
    }
    case 'bear': {
      const { readBear } = await import('./bear')
      return readBear(sources)
    }
    case 'logseq': {
      const { readLogseq } = await import('./logseq')
      return readLogseq(sources)
    }
    case 'roam': {
      const { readRoam } = await import('./roam')
      return readRoam(sources)
    }
    case 'table': {
      const { readTable } = await import('./table')
      return readTable(sources, options.rows ?? 'table')
    }
    case 'tomboy': {
      const { readTomboy } = await import('./tomboy')
      return readTomboy(sources)
    }
    case 'journal': {
      const { readJournal } = await import('./journal')
      return readJournal(sources)
    }
    case 'todoist': {
      const { readTodoistFiles } = await import('./todoist')
      return readTodoistFiles(sources)
    }
    case 'pdf-pages': {
      const { readPdfPages } = await import('./pdf-pages')
      return readPdfPages(sources)
    }
    case 'obsidian': {
      const { readPlain } = await import('./plain')
      const { atVaultTop, leftInVault, lostInVault } = await import('./obsidian')
      const vault = atVaultTop(sources)
      const plan = await readPlain(vault, { format, skip: leftInVault, asTheyAre: true })
      plan.lost.push(...lostInVault(vault))
      return plan
    }
    case 'craft':
    case 'onenote':
    case 'apple-notes':
    case 'markdown': {
      const { readPlain } = await import('./plain')
      const { isHidden } = await import('./folder')
      return readPlain(sources, { format, skip: isHidden })
    }
    case 'pandoc': {
      return { format, files: [], lost: [] }
    }
  }
}
