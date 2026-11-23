import type { AgentAnswer } from '../../automation/src/api'
import { type Call, done, maybe, onDisk, Refused, sharedSource } from '../../agent-verbs/src/api'
import { toBase64 } from '../../platform/src/api'
import { canvasShown, isPlaneCall } from './canvas'
import { at, noteOf } from './notes'
import { notes } from './docs'

interface Area {
  x: number
  y: number
  width: number
  height: number
}
const LONGEST = 1600
const NOTE_WIDTH = 800
function numberOf(call: Call, key: string): number | null {
  const value = call.args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function spanOf(from: number | null, length: number | null, whole: number): [number, number] {
  const start = from ?? 0
  const end = length === null ? whole : start + length
  const low = Math.max(0, Math.min(whole, start))
  return [low, Math.max(low, Math.min(whole, end)) - low]
}
function areaAsked(call: Call, whole: Area, origin = { x: 0, y: 0 }): Area {
  const said = call.args.area
  if (said !== undefined && said !== null) {
    const fine = Array.isArray(said) && said.length === 4 && said.every((one) => Number.isFinite(one))
    if (!fine) throw new Refused('bad_arguments', 'area is [x, y, width, height]')
  }
  const [left, top, wide, high] = (Array.isArray(said) ? said : []) as (number | undefined)[]
  const [x, width] = spanOf(left === undefined ? null : left - origin.x, wide ?? null, whole.width)
  const [y, height] = spanOf(top === undefined ? null : top - origin.y, high ?? null, whole.height)
  if (width < 1 || height < 1) throw new Refused('bad_arguments', 'that area lies outside what there is to see')
  return { x, y, width, height }
}
async function cut(picture: Blob, whole: Area, area: Area) {
  const image = await createImageBitmap(picture)
  try {
    const density = image.width / whole.width
    const by = Math.min(1, LONGEST / Math.max(area.width, area.height))
    const sheet = document.createElement('canvas')
    sheet.width = Math.max(1, Math.round(area.width * by))
    sheet.height = Math.max(1, Math.round(area.height * by))
    const drawing = sheet.getContext('2d')
    if (!drawing) throw new Refused('failed', 'nothing could be drawn')
    drawing.drawImage(
      image,
      area.x * density,
      area.y * density,
      area.width * density,
      area.height * density,
      0,
      0,
      sheet.width,
      sheet.height,
    )
    const png = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'))
    if (!png) throw new Refused('failed', 'nothing could be drawn')
    return { png: toBase64(new Uint8Array(await png.arrayBuffer())), width: sheet.width, height: sheet.height }
  } finally {
    image.close()
  }
}
const blobOf = (bytes: Uint8Array) => new Blob([bytes.slice()], { type: 'image/png' })
async function planeShot(call: Call): Promise<AgentAnswer> {
  const shown = await canvasShown(call)
  const open = { name: shown.name, path: shown.path, root: shown.root }
  if (shown.pages) {
    const out = await (await import('../../pages/src/api')).pagesOut()
    const number = Math.round(numberOf(call, 'page') ?? 1)
    const drawn = await out.pagePng({ ...out.pagesOutOf({ ...open, text: '' }), canvas: shown.canvas }, number)
    if (!drawn) throw new Refused('not_found', `there is no page ${number} to see`)
    const whole = { x: 0, y: 0, width: drawn.page.width, height: drawn.page.height }
    return done({ ...(await cut(blobOf(drawn.bytes), whole, areaAsked(call, whole))), page: number }, shown.source)
  }
  const { canvasPng, drawingOf } = await import('../../plane/src/api')
  const drawn = await canvasPng({ ...drawingOf({ ...open, text: '' }), canvas: shown.canvas })
  if (!drawn) throw new Refused('failed', 'that canvas could not be drawn')
  const whole = { x: 0, y: 0, width: drawn.box.width, height: drawn.box.height }
  const said = areaAsked(call, whole, drawn.box)
  const picture = await cut(drawn.blob, whole, said)
  return done({ ...picture, x: said.x + drawn.box.x, y: said.y + drawn.box.y }, shown.source)
}
async function noteShot(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, false)
  const read = await notes.readNote(at(named), ['text'])
  const path = named.relative ? onDisk(named.place, named.relative) : null
  const target = { source: read.text ?? '', name: named.relative || 'Untitled.md', path, trusted: false }
  const { exporters, renderOptions } = await import('../../export/src/api')
  const { notePng } = await exporters()
  const bytes = await notePng(target, { ...(await renderOptions(target, undefined, 'light')) }, NOTE_WIDTH)
  if (!bytes) throw new Refused('failed', 'that note could not be drawn')
  const image = await createImageBitmap(blobOf(bytes))
  const whole = { x: 0, y: 0, width: image.width, height: image.height }
  image.close()
  const picture = await cut(blobOf(bytes), whole, areaAsked(call, whole))
  return done(picture, sharedSource(named.place, named.relative))
}
export async function noteScreenshot(call: Call): Promise<AgentAnswer> {
  if (maybe(call, 'tab') === null && maybe(call, 'path') === null) {
    throw new Refused('bad_arguments', 'name a tab or a path')
  }
  return isPlaneCall(call) ? planeShot(call) : noteShot(call)
}
