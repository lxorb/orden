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
function areaAsked(call: Call, whole: Area): Area {
  const x = numberOf(call, 'x') ?? 0
  const y = numberOf(call, 'y') ?? 0
  const left = Math.max(0, Math.min(whole.width, x))
  const top = Math.max(0, Math.min(whole.height, y))
  const width = Math.min(whole.width - left, numberOf(call, 'width') ?? whole.width - left)
  const height = Math.min(whole.height - top, numberOf(call, 'height') ?? whole.height - top)
  if (width < 1 || height < 1) throw new Refused('bad_arguments', 'that area lies outside what there is to see')
  return { x: left, y: top, width, height }
}
async function cut(picture: Blob, whole: Area, area: Area, scale: number | null) {
  const image = await createImageBitmap(picture)
  try {
    const density = image.width / whole.width
    const fitted = Math.min(1, LONGEST / Math.max(area.width, area.height))
    const by = Math.min(4, Math.max(0.05, scale ?? fitted))
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
  const scale = numberOf(call, 'scale')
  const open = { name: shown.name, path: shown.path, root: shown.root }
  if (shown.pages) {
    const out = await (await import('../../pages/src/api')).pagesOut()
    const number = Math.round(numberOf(call, 'page') ?? 1)
    const drawn = await out.pagePng({ ...out.pagesOutOf({ ...open, text: '' }), canvas: shown.canvas }, number)
    if (!drawn) throw new Refused('not_found', `there is no page ${number} to see`)
    const whole = { x: 0, y: 0, width: drawn.page.width, height: drawn.page.height }
    return done(
      { ...(await cut(blobOf(drawn.bytes), whole, areaAsked(call, whole), scale)), page: number },
      shown.source,
    )
  }
  const { canvasPng, drawingOf } = await import('../../plane/src/api')
  const drawn = await canvasPng({ ...drawingOf({ ...open, text: '' }), canvas: shown.canvas })
  if (!drawn) throw new Refused('failed', 'that canvas could not be drawn')
  const whole = { x: 0, y: 0, width: drawn.box.width, height: drawn.box.height }
  const said = areaAsked(
    {
      ...call,
      args: {
        ...call.args,
        x: (numberOf(call, 'x') ?? drawn.box.x) - drawn.box.x,
        y: (numberOf(call, 'y') ?? drawn.box.y) - drawn.box.y,
      },
    },
    whole,
  )
  const picture = await cut(drawn.blob, whole, said, scale)
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
  const picture = await cut(blobOf(bytes), whole, areaAsked(call, whole), numberOf(call, 'scale'))
  return done(picture, sharedSource(named.place, named.relative))
}
export async function noteScreenshot(call: Call): Promise<AgentAnswer> {
  if (maybe(call, 'tab') === null && maybe(call, 'path') === null) {
    throw new Refused('bad_arguments', 'name a tab or a path')
  }
  return isPlaneCall(call) ? planeShot(call) : noteShot(call)
}
