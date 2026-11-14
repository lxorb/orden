import type { PDFPageProxy } from 'pdfjs-dist'
import { type OpenPdf, openBytes, openDocument, pdfjs } from './document'
import { matrixOf, type Transform } from './highlights'
import { type PdfHeading, readOutline } from './outline'
import { PDF_TO_CSS } from './pages'
import { runsOfItems, textOfRuns } from './find'
import type { AwayDraw } from './paper-away'
import { fileBytes, pathKey, placesOf, samePath } from '../../platform/src/api'
import { mark } from '../../trace'
import { isPagesTarget } from '@orden/markdown/links'
import { paperOf as ownPaper } from '@orden/markdown/pages'
import { idle } from '../../breathe'
import { SvelteMap } from 'svelte/reactivity'

const paperAway = () =>
  __EVEN_PLUGIN__ || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'
    ? null
    : import('./paper-away')

const SCALE = 2

const ROUGH = 0.5

const SHARP = 4

const DENSITIES = [ROUGH, SCALE, SHARP]

const MOST_PIXELS = 16 * 1024 * 1024

const CLOSE_PIXELS = 64 * 1024 * 1024

const KEPT = 24

const SIDE = 16384

const KEPT_PIXELS = 64 * 1024 * 1024

export function paperPlaces(file: string, note: string | null, root: string | null): string[] {
  const named = placesOf(file, note, root)
  if (!named.length || !note || !isPagesTarget(note)) return named

  const own = ownPaper(note)
  return [own, ...named.filter((one) => !samePath(one, own))]
}

export interface Paper {
  image: ImageBitmap
  width: number
  height: number
}

interface Held {
  open: Promise<OpenPdf>
  place: Promise<string | null>
  bytes: () => Promise<Uint8Array | null>
  away?: Promise<number | null> | undefined
  local: boolean
  drawn: Map<string, Promise<Paper | null>>
  recent: string[]
  pixels: Map<string, number>
  gone: boolean
  texts?: Promise<string[]> | undefined
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

export function sharpness(width: number, height: number, wanted: number): number {
  return Math.min(wanted, SIDE / Math.max(width, height, 1))
}

export function drawScale(width: number, height: number, density: number): number {
  const area = width * height * density * density
  return sharpness(
    width,
    height,
    area > MOST_PIXELS ? density * Math.sqrt(MOST_PIXELS / area) : density,
  )
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
    bytes: () =>
      opening.then(
        (one) => one.copy ?? (one.path ? fileBytes(one.path) : null),
        () => null,
      ),
    local: false,
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

async function opened(
  at: PaperAt,
): Promise<{ pdf: OpenPdf; path: string | null; copy?: Uint8Array }> {
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
  if (fetched) {
    const copy = fetched.slice()
    return { pdf: await openBytes(fetched), path: null, copy }
  }

  throw last instanceof Error ? last : new Error(String(last))
}

async function fromAccount(at: PaperAt): Promise<Uint8Array | null> {
  const id = at.shared ?? (at.note && isPagesTarget(at.note) ? await accountIdOf(at.note) : null)
  if (!id) return null
  const { paperFromAccount } = await (await import('../../sync-client/src/api')).papersCarrying()
  return await paperFromAccount(id, at.shared ? null : at.note)
}

async function accountIdOf(note: string): Promise<string | null> {
  const { sync } = await import('../../sync.svelte')
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

  const scale = PDF_TO_CSS * drawScale(wanted.width, wanted.height, density)
  const view = page.getViewport({ scale })
  const image = await rendered(one, page, {
    number,
    scale,
    offsetX: 0,
    offsetY: 0,
    width: Math.max(1, Math.round(view.width)),
    height: Math.max(1, Math.round(view.height)),
  })
  if (!image) return null

  return { image, width: Math.round(wanted.width), height: Math.round(wanted.height) }
}

function awayOf(one: Held): Promise<number | null> {
  one.away ??= one
    .bytes()
    .then(async (bytes) =>
      bytes && !one.gone ? ((await paperAway())?.openAway(bytes) ?? null) : null,
    )
    .catch(() => null)
  return one.away
}

async function rendered(
  one: Held,
  page: PDFPageProxy,
  asked: AwayDraw,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const door = one.local ? null : paperAway()
  const away = door ? await door : null
  const doc = away?.drawsAway() ? await awayOf(one) : null
  if (away && doc !== null) {
    const drawn = await away.drawAway(doc, asked, signal)
    if (drawn !== away.HERE) {
      page.cleanup()
      return drawn
    }
    one.local = true
    mark('paper drawn here')
  }
  return await drawnHere(page, asked, signal)
}

async function drawnHere(
  page: PDFPageProxy,
  asked: AwayDraw,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const sheet = sheetOf(asked.width, asked.height)
  const ctx = sheet?.getContext('2d') ?? null
  if (!sheet || !ctx || signal?.aborted) {
    page.cleanup()
    return null
  }

  const task = page.render({
    canvas: sheet as HTMLCanvasElement,
    canvasContext: ctx as CanvasRenderingContext2D,
    viewport: page.getViewport({
      scale: asked.scale,
      offsetX: asked.offsetX,
      offsetY: asked.offsetY,
    }),
  })
  const stop = () => task.cancel()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    await task.promise
  } catch {
    return null
  } finally {
    signal?.removeEventListener('abort', stop)
    page.cleanup()
  }
  if (signal?.aborted) return null

  return 'transferToImageBitmap' in sheet
    ? sheet.transferToImageBitmap()
    : await createImageBitmap(sheet)
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
  const scale = sharpness(
    wide,
    tall,
    Math.min(wanted, Math.sqrt(CLOSE_PIXELS / Math.max(1, wide * tall))),
  )
  const image = await rendered(
    one,
    page,
    {
      number,
      scale,
      offsetX: -part.x * whole.width * scale,
      offsetY: -part.y * whole.height * scale,
      width: Math.max(1, Math.floor(wide * scale)),
      height: Math.max(1, Math.floor(tall * scale)),
    },
    signal,
  )
  if (gone()) {
    image?.close()
    return null
  }
  return image
}

const READ_AT_ONCE = 20

export function textsOf(at: PaperAt): Promise<string[]> {
  const one = heldOf(at)
  if (!one) return Promise.resolve([])

  one.texts ??= readTexts(one).catch(() => {
    one.texts = undefined
    return []
  })
  return one.texts
}

async function readTexts(one: Held): Promise<string[]> {
  const opened = await one.open
  const texts: string[] = []

  for (let number = 1; number <= opened.doc.numPages; number++) {
    if (one.gone) return texts
    if (number % READ_AT_ONCE === 0) await idle()
    const content = await opened.doc
      .getPage(number)
      .then((page) => page.getTextContent())
      .catch(() => null)
    texts.push(textOfRuns(runsOfItems(content?.items ?? [])))
  }

  return texts
}

export interface Words {
  runs: string[]
  divs: HTMLElement[]
}

export async function wordsInto(
  at: PaperAt,
  number: number,
  width: number,
  into: HTMLElement,
  signal: AbortSignal,
): Promise<Words | null> {
  const gone = () => signal.aborted
  const one = heldOf(at)
  if (!one || gone()) return null

  const opened = await one.open.catch(() => null)
  if (!opened || gone() || number < 1 || number > opened.doc.numPages) return null

  const read = await Promise.all([pdfjs(), opened.doc.getPage(number)])
    .then(async ([library, page]) => ({ library, page, content: await page.getTextContent() }))
    .catch(() => null)
  if (!read || gone()) return null
  const { library, page, content } = read

  const view = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
  into.replaceChildren()
  into.style.setProperty('--total-scale-factor', String(view.scale))
  const layer = new library.TextLayer({
    textContentSource: content,
    container: into,
    viewport: view,
  })
  const stop = () => layer.cancel()
  signal.addEventListener('abort', stop, { once: true })
  try {
    await layer.render()
  } catch {
    return null
  } finally {
    signal.removeEventListener('abort', stop)
  }
  if (gone()) return null

  return { runs: runsOfItems(content.items), divs: layer.textDivs }
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

export class PapersHeld {
  private held = new Map<string, () => void>()

  keep(papers: readonly PaperAt[]): void {
    const wanted = new Map(papers.map((at) => [keyOf(at), at]))
    for (const [key, at] of wanted) {
      if (!this.held.has(key)) this.held.set(key, holdPaper(at))
    }
    for (const [key, release] of this.held) {
      if (wanted.has(key)) continue
      this.held.delete(key)
      release()
    }
  }

  release(): void {
    this.keep([])
  }
}

const editions = new SvelteMap<string, number>()

export function paperEdition(at: PaperAt): number {
  let edition = 0
  for (const place of paperPlaces(at.file, at.note, at.root)) {
    edition += editions.get(pathKey(place)) ?? 0
  }
  return edition
}

export function paperRewritten(path: string): void {
  const wanted = pathKey(path)
  for (const key of [...held.keys()]) {
    if (key.split('\n').some((place) => pathKey(place) === wanted)) forgetKey(key)
  }
  editions.set(wanted, (editions.get(wanted) ?? 0) + 1)
}

export function forgetPaper(at: PaperAt) {
  forgetKey(keyOf(at))
}

function forgetKey(key: string) {
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
  void one.away?.then(async (doc) => {
    if (doc !== null) (await paperAway())?.closeAway(doc)
  })
  void one.open.then((opened) => opened.close()).catch(() => undefined)
}
