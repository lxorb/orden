import type { CanvasEdge, CanvasNode } from '@orden/markdown/canvas'
import { type Box, boxOf, edgeEnds, fileShown, keptByAccount, overlaps } from '../../plane/src/api'
import type { Palette } from '../../plane/src/api'

export interface FarPicture {
  image: CanvasImageSource
  width: number
  height: number
}

export interface FarScene {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  picked: ReadonlySet<string>
  dimmed: boolean
  skip: string | null
  view: Box
  scale: number
  originX: number
  originY: number
  width: number
  height: number
  palette: Palette
  ratio: number
  font: string
  picture: (file: string) => FarPicture | null
  sheets: FarSheets
}

const CARD_TYPE = 13
const CARD_LEADING = 1.55
const CARD_INSET_X = 12
const CARD_INSET_Y = 8
const LEGIBLE = 3
const PICTURE_SEEN = 12

const FENCE = /^\s*(?:```|~~~)/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const LEAD = /^\s*(?:#{1,6}\s+|>\s?|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)/

export function farWords(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !FENCE.test(line) && !RULE.test(line))
    .map((line) =>
      line
        .replace(LEAD, '')
        .replace(/!\[[^\]]*\]\([^)]*\)|!\[\[[^\]]*\]\]/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|~~|==|`/g, '')
        .replace(/(?<![\w*])[*_](?=\S)|(?<=\S)[*_](?![\w*])/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}

interface Sheet {
  node: CanvasNode
  level: number
  font: string
  colour: string
  image: CanvasImageSource | null
  paper: HTMLCanvasElement
}

interface Look {
  font: string
  colour: string
  picture: FarPicture | null
}

const SHEETS_A_PAINT = 40
const MOST_SHEET_PIXELS = 1 << 20
const MOST_PIXELS = 1 << 24

export class FarSheets {
  private readonly held = new Map<string, Sheet>()
  private made = 0
  private pixels = 0
  waiting = false

  constructor(
    private readonly blank: (width: number, height: number) => HTMLCanvasElement | null,
  ) {}

  begin() {
    this.made = 0
    this.waiting = false
  }

  drawn(node: CanvasNode, level: number, look: Look): HTMLCanvasElement | null {
    const held = this.held.get(node.id)
    const current =
      held?.node === node &&
      held.font === look.font &&
      held.colour === look.colour &&
      held.image === (look.picture?.image ?? null)
    if (current && held.level === level) {
      this.held.delete(node.id)
      this.held.set(node.id, held)
      return held.paper
    }
    if (this.made >= SHEETS_A_PAINT) {
      this.waiting = true
      return current ? held.paper : null
    }
    this.made += 1
    const made = this.make(node, level, look)
    if (held) this.drop(node.id, held)
    if (!made) return null
    this.held.set(node.id, made)
    this.pixels += made.paper.width * made.paper.height
    for (const [id, old] of this.held) {
      if (this.pixels <= MOST_PIXELS || old === made) break
      this.drop(id, old)
    }
    return made.paper
  }

  private drop(id: string, sheet: Sheet) {
    this.held.delete(id)
    this.pixels -= sheet.paper.width * sheet.paper.height
  }

  private make(node: CanvasNode, wanted: number, look: Look): Sheet | null {
    const fits = Math.sqrt(MOST_SHEET_PIXELS / Math.max(1, node.width * node.height))
    const level = Math.min(wanted, fits)
    const paper = this.blank(
      Math.max(1, Math.ceil(node.width * level)),
      Math.max(1, Math.ceil(node.height * level)),
    )
    const pen = paper?.getContext('2d')
    if (!paper || !pen) return null
    pen.setTransform(level, 0, 0, level, 0, 0)
    const box = { x: 0, y: 0, width: node.width, height: node.height }
    if (look.picture) paintPicture(pen, look.picture, box)
    if (node.type === 'text') {
      pen.fillStyle = look.colour
      paintWords(pen, node.text, box, look.font)
    }
    return {
      node,
      level: wanted,
      font: look.font,
      colour: look.colour,
      image: look.picture?.image ?? null,
      paper,
    }
  }
}

function broken(pen: CanvasRenderingContext2D, word: string, room: number): string[] {
  const pieces: string[] = []
  let piece = ''
  for (const letter of word) {
    if (piece && pen.measureText(piece + letter).width > room) {
      pieces.push(piece)
      piece = letter
    } else piece += letter
  }
  if (piece) pieces.push(piece)
  return pieces
}

function wrapped(
  pen: CanvasRenderingContext2D,
  text: string,
  room: number,
  most: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of farWords(text)) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const tried = line ? `${line} ${word}` : word
      if (pen.measureText(tried).width <= room) {
        line = tried
        continue
      }
      if (line) lines.push(line)
      const pieces = pen.measureText(word).width > room ? broken(pen, word, room) : [word]
      line = pieces.pop() ?? ''
      lines.push(...pieces)
      if (lines.length >= most) break
    }
    if (line) lines.push(line)
    if (lines.length >= most) break
  }
  return lines.slice(0, most)
}

function paintWords(pen: CanvasRenderingContext2D, text: string, box: Box, font: string) {
  const step = CARD_TYPE * CARD_LEADING
  const most = Math.max(0, Math.floor((box.height - 2 * CARD_INSET_Y) / step))
  if (!most) return
  pen.font = `${String(CARD_TYPE)}px ${font}`
  pen.textBaseline = 'middle'
  const lines = wrapped(pen, text, box.width - 2 * CARD_INSET_X, most)
  for (const [at, line] of lines.entries()) {
    pen.fillText(line, box.x + CARD_INSET_X, box.y + CARD_INSET_Y + step * (at + 0.5))
  }
}

export function farPictures(
  arrived: () => void,
  signedIn: () => boolean,
): (address: string, file: string) => FarPicture | null {
  const pictures = new Map<string, HTMLImageElement | null>()

  function fetched(address: string, from: string, file: string, again: boolean) {
    const image = new Image()
    image.decoding = 'async'
    image.onload = arrived
    image.onerror = () => {
      const elsewhere = again ? null : keptByAccount(file, signedIn())
      if (elsewhere) fetched(address, elsewhere, file, true)
      else pictures.set(address, null)
    }
    pictures.set(address, image)
    image.src = from
  }

  return (address, file) => {
    const held = pictures.get(address)
    if (held === undefined) fetched(address, address, file, false)
    if (!held?.complete || !held.naturalWidth) return null
    return { image: held, width: held.naturalWidth, height: held.naturalHeight }
  }
}

function paintPicture(pen: CanvasRenderingContext2D, picture: FarPicture, box: Box) {
  const fit = Math.max(box.width / picture.width, box.height / picture.height)
  const wide = box.width / fit
  const tall = box.height / fit
  pen.drawImage(
    picture.image,
    (picture.width - wide) / 2,
    (picture.height - tall) / 2,
    wide,
    tall,
    box.x,
    box.y,
    box.width,
    box.height,
  )
}

export function paintFar(canvas: HTMLCanvasElement, scene: FarScene): boolean {
  const { nodes, edges, picked, dimmed, skip, view, scale, originX, originY, palette, ratio } =
    scene
  const context = canvas.getContext('2d')
  if (!context) return false
  const tint = (colour: string | undefined): string | null =>
    colour === undefined ? null : (palette[colour] ?? colour)
  const wide = Math.max(1, Math.round(scene.width * ratio))
  const tall = Math.max(1, Math.round(scene.height * ratio))
  if (canvas.width !== wide) canvas.width = wide
  if (canvas.height !== tall) canvas.height = tall

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, wide, tall)
  const k = scale * ratio
  context.setTransform(k, 0, 0, k, originX * ratio, originY * ratio)
  const pixel = 1 / scale

  const surface = palette.surface ?? '#ffffff'
  const line = palette.line ?? '#d6d9de'
  const accent = palette.accent ?? '#4c6ef5'
  const muted = palette.muted ?? '#8a9099'
  const words = palette.text ?? '#1f2933'
  const legible = CARD_TYPE * scale >= LEGIBLE
  const level = 2 ** Math.round(Math.log2(k))
  scene.sheets.begin()

  const byId = new Map<string, Box>()
  for (const node of nodes) byId.set(node.id, boxOf(node))

  context.lineCap = 'round'
  for (const edge of edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue
    if (!overlaps(from, view) && !overlaps(to, view)) continue
    const ends = edgeEnds(edge, from, to)
    const chosen = picked.has(edge.id)
    context.globalAlpha = dimmed && !chosen ? 0.25 : 1
    context.strokeStyle = chosen ? accent : (tint(edge.color) ?? muted)
    context.lineWidth = (chosen ? 2 : 1) * pixel
    context.beginPath()
    context.moveTo(ends.from.x, ends.from.y)
    context.lineTo(ends.to.x, ends.to.y)
    context.stroke()
  }

  for (const node of nodes) {
    if (node.id === skip) continue
    const box = byId.get(node.id)
    if (!box || !overlaps(box, view)) continue
    const chosen = picked.has(node.id)
    const colour = tint(node.color)
    context.globalAlpha = dimmed && !chosen ? 0.25 : 1

    if (node.type === 'group') {
      if (colour) {
        context.globalAlpha *= 0.06
        context.fillStyle = colour
        context.fillRect(box.x, box.y, box.width, box.height)
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
    } else {
      context.fillStyle = surface
      context.fillRect(box.x, box.y, box.width, box.height)
      if (colour) {
        context.globalAlpha *= 0.09
        context.fillStyle = colour
        context.fillRect(box.x, box.y, box.width, box.height)
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
      const picture =
        node.type === 'file' &&
        Math.min(box.width, box.height) * scale >= PICTURE_SEEN &&
        fileShown(node.file) === 'picture'
          ? scene.picture(node.file)
          : null
      const worded = node.type === 'text' && node.text.trim() !== '' && legible
      const sheet =
        picture || worded
          ? scene.sheets.drawn(node, level, { font: scene.font, colour: words, picture })
          : null
      if (sheet) {
        context.drawImage(sheet, box.x, box.y, box.width, box.height)
      } else if (node.type === 'text' && node.text.trim() && box.height * scale >= 8) {
        context.fillStyle = muted
        context.globalAlpha *= 0.35
        const inset = Math.min(box.width, box.height) * 0.15
        const bar = Math.max(pixel, box.height * 0.12)
        context.fillRect(box.x + inset, box.y + inset, (box.width - 2 * inset) * 0.7, bar)
        if (box.height * scale >= 16) {
          context.fillRect(
            box.x + inset,
            box.y + inset + 2 * bar,
            (box.width - 2 * inset) * 0.45,
            bar,
          )
        }
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
    }
    context.strokeStyle = chosen ? accent : (colour ?? line)
    context.lineWidth = (chosen ? 2 : 1) * pixel
    context.strokeRect(box.x, box.y, box.width, box.height)
  }
  context.globalAlpha = 1
  return scene.sheets.waiting
}
