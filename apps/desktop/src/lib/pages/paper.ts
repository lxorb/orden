import type { OpenPdf } from '../pdf/document'
import { openBytes, openDocument } from '../pdf/document'
import { matrixOf, type Transform } from '../pdf/highlights'
import { type PdfHeading, readOutline } from '../pdf/outline'
import { PDF_TO_CSS } from '../pdf/pages'
import { isPagesTarget } from '@orden/markdown/links'
import { paperPlaces } from './held'

const SCALE = 2

const ROUGH = 0.5

const SHARP = 4

const DENSITIES = [ROUGH, SCALE, SHARP]

const MOST_PIXELS = 16 * 1024 * 1024

const KEPT = 24

const KEPT_PIXELS = 64 * 1024 * 1024

export interface Paper {
  image: ImageBitmap
  width: number
  height: number
}

interface Held {
  open: Promise<OpenPdf>
  place: Promise<string | null>
  drawn: Map<string, Promise<Paper | null>>
  recent: string[]
  pixels: Map<string, number>
  gone: boolean
}

interface Job {
  one: Held
  number: number
  density: number
  wanted: number
  forever: boolean
  aside: boolean
  settle: (paper: Paper | null) => void
}

const held = new Map<string, Held>()

const queue: Job[] = []

let pumping = false

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

export function densityFor(onScreen: number): number {
  return DENSITIES.find((one) => onScreen <= one) ?? SHARP
}

export function paperOf(
  at: PaperAt,
  number: number,
  signal?: AbortSignal,
  aside = false,
  density = SCALE,
): Promise<Paper | null> {
  const one = heldOf(at)
  if (!one || signal?.aborted) return Promise.resolve(null)

  const key = `${String(number)}@${String(density)}`
  const waiting = queue.find((job) => job.one === one && keyOfJob(job) === key)
  const already = one.drawn.get(key)
  if (already) {
    if (waiting) {
      wants(waiting, signal)
      waiting.aside &&= aside
    } else touch(one, key)
    return already
  }

  const asked = new Promise<Paper | null>((settle) => {
    const job: Job = { one, number, density, wanted: 0, forever: false, aside, settle }
    wants(job, signal)
    queue.push(job)
  })
  one.drawn.set(key, asked)
  void pump()

  return asked
}

function wants(job: Job, signal: AbortSignal | undefined) {
  if (!signal) {
    job.forever = true
    return
  }

  job.wanted++
  signal.addEventListener('abort', () => letGo(job), { once: true })
}

function letGo(job: Job) {
  job.wanted--
  if (job.forever || job.wanted > 0) return

  const at = queue.indexOf(job)
  if (at < 0) return

  queue.splice(at, 1)
  job.one.drawn.delete(keyOfJob(job))
  job.settle(null)
}

function keyOfJob(job: Job): string {
  return `${String(job.number)}@${String(job.density)}`
}

function next(): Job | undefined {
  const at = queue.findIndex((job) => !job.aside)
  return queue.splice(at < 0 ? 0 : at, 1)[0]
}

async function pump() {
  if (pumping) return
  pumping = true

  try {
    for (let job = next(); job; job = next()) {
      const paper = await draw(job.one, job.number, job.density).catch(() => null)
      if (job.one.gone) {
        paper?.image.close()
        job.settle(null)
        continue
      }
      if (!paper) job.one.drawn.delete(keyOfJob(job))
      else {
        job.one.pixels.set(keyOfJob(job), paper.image.width * paper.image.height)
        touch(job.one, keyOfJob(job))
        forgetOldest(job.one)
      }
      job.settle(paper)
    }
  } finally {
    pumping = false
  }
}

export function paperAhead(at: PaperAt): void {
  heldOf(at)
}

export async function outlineOf(at: PaperAt): Promise<PdfHeading[]> {
  const opened = await heldOf(at)?.open.catch(() => null)
  return opened ? await readOutline(opened.doc) : []
}

export async function paperPathOf(at: PaperAt): Promise<string | null> {
  return (await heldOf(at)?.place) ?? null
}

export interface PaperView {
  transform: Transform
  width: number
  height: number
}

export async function viewOf(at: PaperAt, number: number): Promise<PaperView | null> {
  const opened = await heldOf(at)?.open.catch(() => null)
  if (!opened || number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const view = page.getViewport({ scale: 1 })
  return { transform: matrixOf(view.transform), width: view.width, height: view.height }
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
  const opening = opened(at)
  const made: Held = {
    open: opening.then((one) => one.pdf),
    place: opening.then(
      (one) => one.path,
      () => null,
    ),
    drawn: new Map(),
    recent: [],
    pixels: new Map(),
    gone: false,
  }
  made.open.catch(() => {
    if (held.get(key) === made) held.delete(key)
  })
  held.set(key, made)
  return made
}

async function opened(at: PaperAt): Promise<{ pdf: OpenPdf; path: string | null }> {
  const places = paperPlaces(at.file, at.note, at.root)
  let last: unknown = new Error(`${at.file} is nowhere this space can read`)

  for (const path of places) {
    try {
      return { pdf: await openDocument(path), path }
    } catch (error) {
      last = error
    }
  }

  const fetched = await fromAccount(at).catch(() => null)
  if (fetched) return { pdf: await openBytes(fetched), path: null }

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

function touch(one: Held, key: string) {
  const at = one.recent.indexOf(key)
  if (at >= 0) one.recent.splice(at, 1)
  one.recent.push(key)
}

function pixelsOf(one: Held): number {
  let all = 0
  for (const key of one.recent) all += one.pixels.get(key) ?? 0
  return all
}

function forgetOldest(one: Held) {
  while (one.recent.length > KEPT || (one.recent.length > 1 && pixelsOf(one) > KEPT_PIXELS)) {
    const oldest = one.recent.shift()
    if (oldest === undefined) return

    const going = one.drawn.get(oldest)
    one.drawn.delete(oldest)
    one.pixels.delete(oldest)
    void going?.then((paper) => paper?.image.close())
  }
}

async function draw(one: Held, number: number, density: number): Promise<Paper | null> {
  const opened = await one.open
  if (number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const wanted = page.getViewport({ scale: PDF_TO_CSS })

  const area = wanted.width * wanted.height * density * density
  const scale = area > MOST_PIXELS ? density * Math.sqrt(MOST_PIXELS / area) : density
  const view = page.getViewport({ scale: PDF_TO_CSS * scale })

  const paper = sheetOf(Math.max(1, Math.round(view.width)), Math.max(1, Math.round(view.height)))
  const ctx = paper?.getContext('2d') ?? null
  if (!paper || !ctx) {
    page.cleanup()
    return null
  }

  try {
    await page.render({
      canvas: paper as HTMLCanvasElement,
      canvasContext: ctx as CanvasRenderingContext2D,
      viewport: view,
    }).promise
  } finally {
    page.cleanup()
  }

  return {
    image:
      'transferToImageBitmap' in paper
        ? paper.transferToImageBitmap()
        : await createImageBitmap(paper),
    width: Math.round(wanted.width),
    height: Math.round(wanted.height),
  }
}

export interface Part {
  x: number
  y: number
  width: number
  height: number
}

export async function closeUpOf(
  at: PaperAt,
  number: number,
  part: Part,
  across: number,
  signal: AbortSignal,
): Promise<ImageBitmap | null> {
  const gone = () => signal.aborted
  const one = heldOf(at)
  if (!one || gone()) return null

  const opened = await one.open.catch(() => null)
  if (!opened || gone() || number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const whole = page.getViewport({ scale: 1 })
  const wide = part.width * whole.width
  const tall = part.height * whole.height
  const wanted = across / whole.width
  const scale = Math.min(wanted, Math.sqrt(MOST_PIXELS / Math.max(1, wide * tall)))
  const view = page.getViewport({
    scale,
    offsetX: -part.x * whole.width * scale,
    offsetY: -part.y * whole.height * scale,
  })

  const sheet = sheetOf(
    Math.max(1, Math.floor(wide * scale)),
    Math.max(1, Math.floor(tall * scale)),
  )
  const ctx = sheet?.getContext('2d') ?? null
  if (!sheet || !ctx || gone()) {
    page.cleanup()
    return null
  }

  const task = page.render({
    canvas: sheet as HTMLCanvasElement,
    canvasContext: ctx as CanvasRenderingContext2D,
    viewport: view,
  })
  const stop = () => task.cancel()
  signal.addEventListener('abort', stop, { once: true })
  try {
    await task.promise
  } catch {
    return null
  } finally {
    signal.removeEventListener('abort', stop)
    page.cleanup()
  }
  if (gone()) return null

  return 'transferToImageBitmap' in sheet
    ? sheet.transferToImageBitmap()
    : await createImageBitmap(sheet)
}

let offscreen: boolean | undefined

function sheetOf(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  offscreen ??=
    typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d')
  if (offscreen) return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null

  const paper = document.createElement('canvas')
  paper.width = width
  paper.height = height
  return paper
}

const holders = new Map<string, number>()

export function holdPaper(at: PaperAt): () => void {
  const key = keyOf(at)
  holders.set(key, (holders.get(key) ?? 0) + 1)

  let holding = true
  return () => {
    if (!holding) return
    holding = false

    const left = (holders.get(key) ?? 1) - 1
    if (left > 0) {
      holders.set(key, left)
      return
    }
    holders.delete(key)
    forgetPaper(at)
  }
}

export function forgetPaper(at: PaperAt) {
  const key = keyOf(at)
  const one = held.get(key)
  if (!one) return

  held.delete(key)
  one.gone = true
  for (let at = queue.length - 1; at >= 0; at--) {
    const job = queue[at]
    if (job?.one !== one) continue
    queue.splice(at, 1)
    job.settle(null)
  }
  for (const drawing of one.drawn.values()) void drawing.then((paper) => paper?.image.close())
  void one.open.then((opened) => opened.close()).catch(() => undefined)
}
