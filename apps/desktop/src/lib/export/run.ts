import { loadFor } from '@orden/markdown/engines'
import { numbered } from '@orden/markdown/paths'
import type { FoundLink } from '@orden/markdown/links'
import {
  buildBody,
  buildStyles,
  type HtmlOptions,
  prepareEmbeds,
  prepareFences,
  renderNote,
} from '../export'
import { pageSetupFor, paperInches, type PaperTwips, paperTwips, runningDate } from '../page-setup'
import { DEFAULT_PAGE_SETUP } from '../paper'
import { nameOf, invoke, isDesktop, isNative } from '../platform/src/api'
import { documentOf, picturesIn } from './document'
import { type Exportable, EXPORT_FORMATS, EXPORT_VARIANTS, extensionFor, TEXTPACK } from './formats'
import { toMarkdown } from './markdown'
import { fileNameFor } from './naming'
import { writtenPdf } from './print'
import { type Picture, readPictures, sourcesIn } from './pictures'
import { pageWith, printWithPictures, wholeSheet } from './sheet'
import { chooseTarget, deliver, type Payload } from './save'
import { toPlainText } from './text'
import { bundleFiles, packEntries } from './textbundle'
import { workspace } from '../workspace.svelte'
import { zipOf } from './zip'

export interface Note {
  source: string
  name: string
  path: string | null
}

export interface RunOptions extends HtmlOptions {
  link?: (link: FoundLink) => string | null
  background?: string
  now?: string
}

const MOST_PIXELS = 16384

function labelFor(id: Exportable): string {
  const format = EXPORT_FORMATS.find((one) => one.id === id)
  if (format) return format.label

  const variant = EXPORT_VARIANTS.find((one) => one.id === id)
  return variant ? variant.label : id
}

async function pageOf(note: Note, options: RunOptions, pictures?: readonly Picture[]) {
  return renderNote(note.source, note.name, options, pictures)
}

async function partsOf(note: Note, options: RunOptions) {
  const fence = await prepareFences(note.source, options.scheme ?? 'light')
  const embed = options.readNote ? await prepareEmbeds(note.source, options.readNote) : undefined
  const body = buildBody(note.source, { ...options, fence, ...(embed ? { embed } : {}) })

  return { body, css: buildStyles(body, note.source, options) }
}

function picturesOf(sources: readonly string[], options: RunOptions) {
  return readPictures(sources, options.resolveImage ?? ((src) => src))
}

function paperFor(note: Note, options: RunOptions, title: string): PaperTwips {
  const setup = pageSetupFor(note.source, options.page ?? DEFAULT_PAGE_SETUP)

  return paperTwips(setup, title, runningDate(note.source, options.date))
}

async function exportPdf(note: Note, options: RunOptions): Promise<string | null> {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(note.name, 'pdf', 'PDF') : null
  if (native && !target) return null

  const { resolveImage, ...plain } = options
  const html = await pageOf(note, { ...plain, scheme: 'light' })
  const page = paperInches(pageSetupFor(note.source, options.page ?? DEFAULT_PAGE_SETUP))

  if (target) {
    if (await writtenPdf(await wholeSheet(html, resolveImage), target, page)) return target
  }

  await printWithPictures(html, resolveImage, page)
  return null
}

async function exportPicture(
  id: 'jpg' | 'png',
  note: Note,
  options: RunOptions,
): Promise<string | null> {
  const mime = id === 'png' ? 'image/png' : 'image/jpeg'
  const html = await pageOf(note, options, await picturesFor(note, options, true))
  const { toImages } = await import('./image')

  const pages = await toImages(html, {
    mime,
    scale: 2,
    background: options.background ?? '#ffffff',
    pageHeight: MOST_PIXELS,
  })

  const first = pages[0]
  if (!first) throw new Error('Nothing came out of that export')
  if (pages.length === 1) return deliver(note.name, id, labelFor(id), { bytes: first, mime })

  const file = fileNameFor(note.name, id)
  return deliver(note.name, id, labelFor(id), {
    files: pages.map((bytes, at) => ({ path: numbered(file, at + 1), body: bytes })),
    folder: false,
  })
}

async function picturesFor(note: Note, options: RunOptions, whole: boolean): Promise<Picture[]> {
  if (!whole) return picturesOf(picturesIn(documentOf(note.source, note.name)), options)

  const html = await pageOf(note, { ...options, bare: true })
  return picturesOf(sourcesIn(html), options)
}

async function exportBundle(note: Note, options: RunOptions): Promise<string | null> {
  const pictures = await picturesFor(note, options, false)
  const files = bundleFiles(note.source, pictures, options.link ? { link: options.link } : {})

  if (isNative) {
    return deliver(note.name, 'textbundle', labelFor('textbundle'), { files, folder: true })
  }

  const bundle = fileNameFor(note.name, 'textbundle')
  const bytes = await zipOf(packEntries(bundle, files))

  return deliver(note.name, TEXTPACK, labelFor('textbundle'), {
    bytes,
    mime: 'application/octet-stream',
  })
}

async function exportMarkdownWithPictures(note: Note, options: RunOptions): Promise<string | null> {
  const pictures = await picturesFor(note, options, false)
  const besideOf = (named: readonly Picture[]) =>
    bundleFiles(note.source, named, options.link ? { link: options.link } : {})
      .filter((file) => file.path !== 'info.json')
      .map((file) =>
        file.path === 'text.md' ? { ...file, path: fileNameFor(note.name, 'md') } : file,
      )
  const beside = besideOf(pictures)

  if (isNative) {
    const relink = (landed: ReadonlyMap<string, string>) => {
      const moved = pictures.map((picture) => {
        const path = landed.get(`assets/${picture.name}`)
        return path ? { ...picture, name: nameOf(path) } : picture
      })
      const text = fileNameFor(note.name, 'md')
      return besideOf(moved).find((file) => file.path === text)?.body ?? ''
    }

    return deliver(note.name, 'md', labelFor('md-assets'), {
      files: beside,
      folder: false,
      relink,
    })
  }

  const bytes = await zipOf(beside)
  return deliver(note.name, 'zip', labelFor('md-assets'), {
    bytes,
    mime: 'application/zip',
  })
}

type OneFile = Exclude<Exportable, 'pdf' | 'jpg' | 'png' | 'textbundle' | 'md-assets'>

async function payloadFor(id: OneFile, note: Note, options: RunOptions): Promise<Payload> {
  switch (id) {
    case 'txt':
      return { text: toPlainText(documentOf(note.source, note.name)), mime: 'text/plain' }

    case 'md':
      return {
        text: toMarkdown(note.source, options.link ? { link: options.link } : {}),
        mime: 'text/markdown',
      }

    case 'html':
      return {
        pieces: pageWith(await pageOf(note, options, []), await picturesFor(note, options, true)),
      }

    case 'html-bare':
      return { text: await pageOf(note, { ...options, bare: true }), mime: 'text/html' }

    case 'rtf': {
      const { toRtf } = await import('./rtf')
      const doc = documentOf(note.source, note.name)
      return {
        text: toRtf(
          doc,
          await picturesOf(picturesIn(doc), options),
          paperFor(note, options, doc.title),
        ),
        mime: 'application/rtf',
      }
    }

    case 'docx': {
      const { toDocx } = await import('./docx')
      const doc = documentOf(note.source, note.name)
      const bytes = await toDocx(
        doc,
        await picturesOf(picturesIn(doc), options),
        paperFor(note, options, doc.title),
      )
      return {
        bytes,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }
    }

    case 'epub': {
      const { toEpub } = await import('./epub')
      const doc = documentOf(note.source, note.name)
      const { body, css } = await partsOf(note, options)

      const bytes = await toEpub({
        title: doc.title,
        author: doc.author,
        lang: doc.lang,
        identifier: `urn:orden:${encodeURIComponent(note.path ?? doc.title)}`,
        modified: (options.now ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z'),
        body,
        css,
        pictures: await picturesOf(sourcesIn(body), options),
      })

      return { bytes, mime: 'application/epub+zip' }
    }
  }
}

async function withKept(note: Note): Promise<Note> {
  if (note.path === null) return note
  const { withOwnKeys } = await import('../own-keys')
  const source = withOwnKeys(note.source, workspace.itemMeta.of(note.path))
  return source === note.source ? note : { ...note, source }
}

export async function runExport(
  id: Exportable,
  given: Note,
  options: RunOptions = {},
): Promise<string | null> {
  const note = await withKept(given)
  await loadFor(note.source)

  if (id === 'pdf') return exportPdf(note, options)
  if (id === 'jpg' || id === 'png') return exportPicture(id, note, options)
  if (id === 'textbundle') return exportBundle(note, options)
  if (id === 'md-assets') return exportMarkdownWithPictures(note, options)

  const payload = await payloadFor(id, note, options)
  return deliver(note.name, extensionFor(id), labelFor(id), payload)
}
