import { freePath } from '@orden/markdown/paths'
import { stripFrontMatter, writeFrontMatter } from '@orden/markdown/front-matter'
import { asWords } from '@orden/markdown/words'
import type { AgentAnswer } from '../automation/caller'
import { attachmentFolder } from '../attachments'
import { modes } from '../modes.svelte'
import { paperInches } from '../page-setup'
import { settings } from '../settings.svelte'
import { notePath, relativeTo, invoke, decoded } from '../platform/src/api'
import { pages } from '../web-tab/src/pages.svelte'
import { clipNote } from '../web-tab/src/note'
import { type Entry, workspace } from '../workspace.svelte'
import { notes } from './docs'
import { CAPTURE_AS, type CaptureAs, type Code, type Overview } from '../agents/src/api'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, needScope, writerOf } from './call'
import { made, madeOrChanged } from './notes'
import { Refused } from './problem'
import {
  judgedForWriting,
  onDisk,
  type Place,
  placeFor,
  placeOf,
  tabsInReach,
  writableAt,
} from './spaces'
import { treeOf } from './tree'

const SHAPES = [...CAPTURE_AS, 'link'] as const
type Shape = (typeof SHAPES)[number]

interface Kept {
  base64: string
  extension: 'png' | 'pdf'
}

interface Page {
  url: string
  title: string
  html: string
  file: Kept | null
}

function isShape(value: string): value is Shape {
  return SHAPES.some((one) => one === value)
}

async function pageIn(call: Call, tab: string, shape: Shape): Promise<Page> {
  const reader = workspace.tabs.find((one) => one.id === tab && one.kind === 'web')
  if (reader) {
    needScope(call, 'browser.reader', "the reader's tab")
    placeFor(call, null)
    if (!tabsInReach(call).includes(reader)) {
      throw new Refused('no_such_tab', `there is no tab ${tab}: browser_tabs lists them`)
    }
    const known: Page = {
      url: pages.addressOf(tab) ?? workspace.webAddressOf(reader) ?? '',
      title: reader.shown,
      html: '',
      file: null,
    }
    if (shape === 'link') return known
    if (shape === 'screenshot' && workspace.showing(reader.paneId)?.id !== reader.id) {
      throw new Refused('failed', 'the page is not on screen, so there is no picture of it')
    }
    return readersPage(call, tab, shape, known)
  }

  needScope(call, 'browser', 'an agent tab')
  if (shape !== 'link') return captured(call, tab, shape)

  const state = await invoke<Overview>('agents_state').catch(() => null)
  const own = state?.tabs.find(([agent, one]) => agent === call.caller.agent?.id && one.id === tab)
  if (!own) throw new Refused('no_such_tab', `there is no tab ${tab}: browser_tabs lists them`)
  return { url: own[1].url, title: own[1].title, html: '', file: null }
}

async function readersPage(call: Call, tab: string, shape: CaptureAs, known: Page): Promise<Page> {
  try {
    return await captured(call, tab, shape)
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    if (error.code === 'unsupported_on_this_engine' && shape === 'clip') {
      const read = await pages.read(tab, false)
      return read ? { ...read, file: null } : known
    }
    if (error.code === 'no_such_tab') {
      if (shape === 'clip') return known
      throw new Refused('failed', "that tab's page is put away until the reader looks at it again")
    }
    throw error
  }
}

async function captured(call: Call, tab: string, shape: CaptureAs): Promise<Page> {
  const said = recordOf(
    await invoke<unknown>('agents_capture', {
      agent: call.caller.agent?.id ?? null,
      tab,
      shape,
      fullPage: flag(call, 'full_page'),
      page: paperInches(settings.page),
    }).catch((error: unknown) => ({ status: 'error', code: 'failed', message: String(error) })),
  )

  if (said.status === 'error') {
    const message = typeof said.message === 'string' ? said.message : 'the page was not read'
    throw new Refused(String(said.code) as Code, message)
  }
  if (said.status !== 'ok') throw new Refused('failed', 'the page was not read')

  const page = pageOf(recordOf(said.result), shape)
  if (shape !== 'clip' && !page.file) throw new Refused('failed', 'the engine answered nothing')
  return page
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function pageOf(record: Record<string, unknown>, shape: CaptureAs): Page {
  const words = (key: string) => (typeof record[key] === 'string' ? record[key] : '')
  const base64 = shape === 'screenshot' ? words('png') : shape === 'pdf' ? words('pdf') : ''

  return {
    url: words('url'),
    title: words('title'),
    html: words('html'),
    file: base64 ? { base64, extension: shape === 'pdf' ? 'pdf' : 'png' } : null,
  }
}

async function wordsFor(page: Page, shape: Shape, embed: string | null): Promise<string> {
  if (shape === 'clip') return clipNote(page, new Date())

  const title = page.title.trim() || page.url
  const shown = embed === null ? `<${page.url}>` : `![[${embed}]]`
  return `${frontMatter(page, title)}\n\n# ${asWords(title)}\n\n${shown}\n`
}

function frontMatter(page: Page, title: string): string {
  return writeFrontMatter([
    ['source', page.url],
    ['title', title],
    ['date', new Date().toISOString()],
  ])
}

function body(words: string): string {
  return stripFrontMatter(words).trim()
}

async function freshPath(place: Place, folder: string | null, title: string): Promise<string> {
  const tree = await treeOf(place)
  const taken = new Set<string>()
  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      taken.add(relativeTo(place.space.root, child.path))
      walk(child)
    }
  }
  if (tree) walk(tree)

  const stem =
    title
      .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Untitled'
  const inside = (name: string) => (folder ? `${folder}/${name}` : name)
  return inside(freePath(`${stem}.md`, (candidate) => taken.has(inside(candidate))))
}

export async function captureToNote(call: Call): Promise<AgentAnswer> {
  const shape = maybe(call, 'as') ?? 'clip'
  if (!isShape(shape)) throw new Refused('bad_arguments', `as is one of ${SHAPES.join(', ')}`)

  const place = placeOf(call)
  const page = await pageIn(call, need(call, 'tab'), shape)
  if (!page.url) throw new Refused('failed', 'that tab has no page to capture')

  const named = maybe(call, 'note')
  const target = named === null ? null : judgedForWriting(named)
  const relative =
    target === null
      ? await freshPath(place, maybe(call, 'folder'), page.title || page.url)
      : notePath(target)
  if (relative === null) throw new Refused('bad_arguments', `${target} is not a markdown note`)

  const path = onDisk(place, relative)
  writableAt(place, path)

  const question = await asked(call, null, `Capture ${page.url} into ${relative}`)
  if (question) return question

  const embed = page.file ? await attachment(place, path, page.file) : null
  const words = await wordsFor(page, shape, embed)

  const under = maybe(call, 'under')
  const title = page.title.trim() || page.url
  const section = `## ${asWords(title)}\n\n${shape === 'clip' ? `<${page.url}>\n\n` : ''}${body(words).replace(/^# .*\n+/, '')}`
  const created = await madeOrChanged(
    place,
    relative,
    async () => {
      await made(place, relative, words, null)
      return true
    },
    async () => {
      await notes.editNote(writerOf(call), { path: relative, space: place.space.id }, [
        { at: under === null ? { end: true } : { heading: under }, insert_after: section },
      ])
      return false
    },
  )

  return done({ path: relative, space: place.space.id, source: page.url, created }, page.url)
}

async function attachment(place: Place, notePath: string, file: Kept): Promise<string> {
  writableAt(place, notePath)
  const bytes = await decoded(`data:application/octet-stream;base64,${file.base64}`)
  const saved = await invoke<string>('save_asset', {
    notePath,
    folder: attachmentFolder(modes.attachments, notePath, place.space.root),
    name: `page-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${file.extension}`,
    bytes,
  })

  return saved
}
