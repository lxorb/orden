import { isPdfTarget } from '@orden/markdown/links'
import { readable } from './guarded'
import type { AgentAnswer } from '../automation/caller'
import {
  COLOURS,
  frozen,
  type Held,
  type Highlight,
  marksWritten,
  editHighlights,
  loadHighlights,
  openDocument,
  paperText,
} from '../pdf/src/api'
import { canWriteAt } from '../sharing/src/api'
import { asked } from './asks'
import { type Call, done, maybe, need, needScope } from './call'
import { pagesAsked, quadsOver, quoteIn, type Run, runsOf } from './pdf-text'
import { Refused } from './problem'
import { judged, onDisk, type Place, placeOf } from './spaces'
import { namedTab } from './tab-target'

const MOST_CHARACTERS = 200_000

function pdfOf(call: Call): { place: Place; relative: string; path: string } {
  if (maybe(call, 'tab') !== null) {
    const { place, relative } = namedTab(call, ['pdf'], 'a PDF')
    if (relative === null) throw new Refused('by_hand', 'that PDF is outside every space')
    return pdfOf({
      ...call,
      args: { ...call.args, tab: null, path: relative, space: place.space.id },
    })
  }

  const place = placeOf(call)
  const relative = judged(need(call, 'path'))
  if (!isPdfTarget(relative)) throw new Refused('bad_arguments', `${relative} is not a PDF`)

  readable(onDisk(place, relative), relative)
  return { place, relative, path: onDisk(place, relative) }
}

async function opened(path: string) {
  return openDocument(path).catch(() => {
    throw new Refused('failed', 'that PDF could not be read')
  })
}

export async function readPdf(call: Call): Promise<AgentAnswer> {
  const { relative, path } = pdfOf(call)
  const held = await opened(path)

  try {
    const count = held.doc.numPages
    const pages: { page: number; text: string }[] = []
    let characters = 0
    let truncated = false

    const kept = new Map((await paperText(path, undefined, held.hash))?.pages ?? [])

    for (const page of pagesAsked(maybe(call, 'pages'), count)) {
      let text = kept.get(page)
      if (text === undefined) {
        const read = await held.doc.getPage(page)
        text = runsOf((await read.getTextContent()).items)
          .map((run) => run.str)
          .join('')
        read.cleanup()
      }

      if (characters + text.length > MOST_CHARACTERS) {
        truncated = true
        break
      }
      characters += text.length
      pages.push({ page, text })
    }

    return done(
      { path: relative, count, pages, ...(truncated ? { truncated: true } : {}) },
      relative,
    )
  } finally {
    await held.close()
  }
}

const HELD: Record<Held, string> = {
  newer:
    'the highlights beside that PDF were written by a newer Orden, so they were left as they are',
  unreadable: 'the highlights beside that PDF could not be read, so they were left as they are',
  damaged: 'the highlights file beside that PDF is damaged, so it was left as it is',
}

export async function pdfHighlights(call: Call): Promise<AgentAnswer> {
  const { relative, path } = pdfOf(call)
  const sheet = await loadHighlights(path)

  switch (need(call, 'op')) {
    case 'list': {
      const held = frozen(sheet)
      if (held && held !== 'newer') throw new Refused('failed', HELD[held])
      return done(
        sheet.highlights.map(({ id, page, text, colour, created }) => ({
          id,
          page,
          text,
          colour,
          created: new Date(created).toISOString(),
        })),
        relative,
      )
    }

    case 'add': {
      needScope(call, 'notes.write', 'a highlight')
      if (!canWriteAt(path)) throw new Refused('read_only', 'that PDF is shared with you to read')

      const mark = await markOf(call, path)
      const question = await asked(
        call,
        null,
        `Highlight "${mark.text.slice(0, 80)}" in ${relative}`,
      )
      if (question) return question

      const written = await editHighlights(path, (now) => ({
        ...now,
        highlights: [...now.highlights, mark],
      }))
      if (typeof written === 'string') throw new Refused('failed', HELD[written])
      marksWritten(path)
      const comment = maybe(call, 'comment') === null ? {} : { comment: 'not kept' }
      return done({ id: mark.id, page: mark.page, text: mark.text, ...comment })
    }

    default:
      throw new Refused('bad_arguments', 'op is one of list, add')
  }
}

function colourOf(said: unknown): number {
  const named = ['accent', 'green', 'yellow'].indexOf(String(said).trim().toLowerCase())
  if (named !== -1) return named

  const at = Math.floor(Number(said))
  return Number.isInteger(at) && at >= 0 && at < COLOURS.length ? at : 0
}

async function markOf(call: Call, path: string): Promise<Highlight> {
  const quote = need(call, 'quote')
  const asked = Number(call.args.page)
  const colour = colourOf(call.args.colour)
  const held = await opened(path)

  try {
    const pages =
      Number.isInteger(asked) && asked >= 1 ? [asked] : pagesAsked(null, held.doc.numPages)
    const found: { page: number; runs: Run[]; from: number; to: number }[] = []

    for (const page of pages) {
      if (page > held.doc.numPages)
        throw new Refused('not_found', `the PDF has ${held.doc.numPages} pages`)

      const read = await held.doc.getPage(page)
      const runs = runsOf((await read.getTextContent()).items)
      read.cleanup()
      for (const place of quoteIn(runs, quote)) found.push({ page, runs, ...place })
    }

    const [only] = found
    if (!only)
      throw new Refused(
        'not_found',
        `"${quote}" is not in the PDF${pages.length === 1 ? ` on page ${pages[0]}` : ''}`,
      )
    if (found.length > 1) {
      const where = [...new Set(found.map((one) => one.page))].join(', ')
      throw new Refused(
        'bad_arguments',
        `"${quote}" is there ${found.length} times (pages ${where}): quote more of it`,
      )
    }

    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      page: only.page,
      text: quote,
      quads: quadsOver(only.runs, only.from, only.to),
      colour,
      created: Date.now(),
    }
  } finally {
    await held.close()
  }
}
