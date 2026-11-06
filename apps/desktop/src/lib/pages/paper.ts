import type { OpenPdf } from '../pdf/document'
import { openBytes, openDocument } from '../pdf/document'
import { PDF_TO_CSS } from '../pdf/pages'
import { isPagesTarget } from '@orden/markdown/links'
import { paperPlaces } from './held'

const SCALE = 2

const MOST_PIXELS = 16 * 1024 * 1024

const KEPT = 24

export interface Paper {
  image: ImageBitmap
  width: number
  height: number
}

interface Held {
  open: Promise<OpenPdf>
  drawn: Map<number, Promise<Paper | null>>
  recent: number[]
}

const held = new Map<string, Held>()

export interface PaperAt {
  file: string
  note: string | null
  root: string | null
  shared?: string | null
}

function keyOf(at: PaperAt): string {
  const places = paperPlaces(at.file, at.note, at.root)
  return at.shared ? [...places, `#${at.shared}`].join('\n') : places.join('\n')
}

export function paperOf(at: PaperAt, number: number): Promise<Paper | null> {
  const one = heldOf(at)
  if (!one) return Promise.resolve(null)

  const already = one.drawn.get(number)
  if (already) {
    touch(one, number)
    return already
  }

  const drawing = draw(one, number).catch(() => null)
  one.drawn.set(number, drawing)
  touch(one, number)
  forgetOldest(one)

  return drawing
}

export async function paperIsLocked(at: PaperAt): Promise<boolean> {
  const one = heldOf(at)
  if (!one) return false
  const opened = await one.open.catch(() => null)
  return !!opened && (await opened.doc.getPermissions()) !== null
}

function heldOf(at: PaperAt): Held | null {
  const key = keyOf(at)
  if (!key) return null

  const known = held.get(key)
  if (known) return known
  const made: Held = { open: opened(at), drawn: new Map(), recent: [] }
  made.open.catch(() => {
    if (held.get(key) === made) held.delete(key)
  })
  held.set(key, made)
  return made
}

async function opened(at: PaperAt): Promise<OpenPdf> {
  const places = paperPlaces(at.file, at.note, at.root)
  let last: unknown = new Error(`${at.file} is nowhere this space can read`)

  for (const path of places) {
    try {
      return await openDocument(path)
    } catch (error) {
      last = error
    }
  }

  const fetched = await fromAccount(at).catch(() => null)
  if (fetched) return await openBytes(fetched)

  throw last instanceof Error ? last : new Error(String(last))
}

async function fromAccount(at: PaperAt): Promise<Uint8Array | null> {
  const id = at.shared ?? (at.note && isPagesTarget(at.note) ? await accountIdOf(at.note) : null)
  if (!id) return null
  const { paperFromAccount } = await import('./carrying')
  return await paperFromAccount(id, at.shared ? null : at.note)
}

async function accountIdOf(note: string): Promise<string | null> {
  const { sync } = await import('../sync.svelte')
  return sync.tracked(note)?.id ?? null
}

function touch(one: Held, number: number) {
  const at = one.recent.indexOf(number)
  if (at >= 0) one.recent.splice(at, 1)
  one.recent.push(number)
}

function forgetOldest(one: Held) {
  while (one.recent.length > KEPT) {
    const oldest = one.recent.shift()
    if (oldest === undefined) return

    const going = one.drawn.get(oldest)
    one.drawn.delete(oldest)
    void going?.then((paper) => paper?.image.close())
  }
}

async function draw(one: Held, number: number): Promise<Paper | null> {
  const opened = await one.open
  if (number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const wanted = page.getViewport({ scale: PDF_TO_CSS })

  const area = wanted.width * wanted.height * SCALE * SCALE
  const scale = area > MOST_PIXELS ? SCALE * Math.sqrt(MOST_PIXELS / area) : SCALE
  const view = page.getViewport({ scale: PDF_TO_CSS * scale })

  const paper = document.createElement('canvas')
  paper.width = Math.max(1, Math.round(view.width))
  paper.height = Math.max(1, Math.round(view.height))

  const ctx = paper.getContext('2d')
  if (!ctx) {
    page.cleanup()
    return null
  }

  await page.render({ canvas: paper, canvasContext: ctx, viewport: view }).promise
  page.cleanup()

  return {
    image: await createImageBitmap(paper),
    width: Math.round(wanted.width),
    height: Math.round(wanted.height),
  }
}

export function forgetPaper(at: PaperAt) {
  const key = keyOf(at)
  const one = held.get(key)
  if (!one) return

  held.delete(key)
  for (const drawing of one.drawn.values()) void drawing.then((paper) => paper?.image.close())
  void one.open.then((opened) => opened.close()).catch(() => undefined)
}
