import type { InkStroke } from '@orden/markdown/canvas'
import type { Box } from '../../plane/src/api'
import { strokeBox } from '../../plane/src/api'
import { InkGrid } from './ink-grid'
import {
  fillInk,
  firstSeen,
  inkKind,
  origin,
  outlined,
  type Paintable,
  paintPicked,
  type Palette,
  pathOf,
  plain,
  seen,
  type View,
  wipe,
} from '../../plane/src/api'
import { hunksOf } from '@orden/markdown/canvas-merge'

export const TILE = 256

export const FILLED_A_FRAME = 2048

export const OUTLINE_WEIGHT = 8

export const FILE_WEIGHT = 0.25

const FRAME_TIME = 6

const KEPT = 2

const MOST_PATCHES = 8

export interface Surface {
  image: CanvasImageSource
  context: Paintable
}

export type MakeSurface = (size: number) => Surface | null

function makeSurface(size: number): Surface | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  return context ? { image: canvas, context } : null
}

interface Patch {
  left: number
  top: number
  right: number
  bottom: number
}

interface Tile {
  across: number
  down: number
  surface: Surface | null
  stale: boolean
  patches: Patch[]
  adds: InkStroke[]
  used: number
}

interface Painted {
  scale: number
  x: number
  y: number
  width: number
  height: number
}

interface Spot {
  across: number
  down: number
}

const SPAN = 2 ** 21
const HALF = 2 ** 20

function keyOf(across: number, down: number): number {
  return (across + HALF) * SPAN + (down + HALF)
}

function grewFrom(was: readonly InkStroke[], now: readonly InkStroke[]): boolean {
  if (now.length < was.length) return false
  for (let one = 0; one < was.length; one++) if (was[one] !== now[one]) return false

  return true
}

function changed(
  was: readonly InkStroke[],
  now: readonly InkStroke[],
): { gone: InkStroke[]; added: InkStroke[] } {
  const hunks = hunksOf(was, now)
  const before = hunks.flatMap((hunk) => hunk.was)
  const after = hunks.flatMap((hunk) => hunk.is)
  const had = new Set(before)
  const has = new Set(after)

  return {
    gone: before.filter((stroke) => !has.has(stroke)),
    added: after.filter((stroke) => !had.has(stroke)),
  }
}

function sameOrder(was: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>): boolean {
  let last = -1
  for (const kind of now.keys()) {
    const at = was.get(kind)
    if (at === undefined) continue
    if (at < last) return false
    last = at
  }

  return true
}

function samePalette(one: Palette, other: Palette | null): boolean {
  if (!other) return false
  if (one === other) return true

  const keys = Object.keys(one)
  return (
    keys.length === Object.keys(other).length &&
    keys.every((key) => Object.hasOwn(other, key) && one[key] === other[key])
  )
}

const WHOLE: Patch = { left: 0, top: 0, right: TILE, bottom: TILE }

function bounds(patches: readonly Patch[]): Patch {
  return {
    left: patches.map((one) => one.left).reduce((low, one) => Math.min(low, one), Infinity),
    top: patches.map((one) => one.top).reduce((low, one) => Math.min(low, one), Infinity),
    right: patches.map((one) => one.right).reduce((high, one) => Math.max(high, one), -Infinity),
    bottom: patches.map((one) => one.bottom).reduce((high, one) => Math.max(high, one), -Infinity),
  }
}

export class InkTiles {
  readonly #make: MakeSurface
  readonly #spare: Surface[] = []

  #strokes: readonly InkStroke[] = []
  readonly #grid = new InkGrid()
  #unfiled: InkStroke[] = []
  #filed = 0
  #order = new Map<string, number>()
  #palette: Palette | null = null

  #scale = 0
  readonly #tiles = new Map<number, Tile>()
  #repaints = 0
  #painted: Painted | null = null

  constructor(make: MakeSurface = makeSurface) {
    this.#make = make
  }

  paint(
    ctx: CanvasRenderingContext2D,
    strokes: readonly InkStroke[],
    view: View,
    palette: Palette,
    picked?: ReadonlySet<string>,
  ): boolean {
    this.#repaints++

    const scale = view.camera.scale * view.ratio
    if (scale !== this.#scale) {
      this.#scale = scale
      for (const tile of this.#tiles.values()) this.#release(tile)
      this.#tiles.clear()
    }

    if (!samePalette(palette, this.#palette)) {
      this.#palette = palette
      for (const tile of this.#tiles.values()) tile.stale = true
    }

    if (strokes !== this.#strokes) this.#follow(strokes)

    const wanted = this.#wanted(view)
    const pending = this.#fill(wanted, palette)
    this.#compose(ctx, wanted, view)
    if (picked) paintPicked(ctx, strokes, picked, view, palette)
    this.#letGo(wanted)

    return pending
  }

  #plane(tile: Spot, patch: Patch): Box {
    const scale = this.#scale
    return {
      x: (tile.across * TILE + patch.left - 1) / scale,
      y: (tile.down * TILE + patch.top - 1) / scale,
      width: (patch.right - patch.left + 2) / scale,
      height: (patch.bottom - patch.top + 2) / scale,
    }
  }

  #patch(tile: Spot, box: Box): Patch | null {
    const scale = this.#scale
    const left = Math.max(0, Math.floor(box.x * scale - tile.across * TILE) - 1)
    const top = Math.max(0, Math.floor(box.y * scale - tile.down * TILE) - 1)
    const right = Math.min(TILE, Math.ceil((box.x + box.width) * scale - tile.across * TILE) + 1)
    const bottom = Math.min(TILE, Math.ceil((box.y + box.height) * scale - tile.down * TILE) + 1)

    return right > left && bottom > top ? { left, top, right, bottom } : null
  }

  #touched(box: Box, visit: (tile: Tile) => void) {
    const spare = 1 / this.#scale
    const left = Math.floor(((box.x - spare) * this.#scale) / TILE)
    const right = Math.floor(((box.x + box.width + spare) * this.#scale) / TILE)
    const top = Math.floor(((box.y - spare) * this.#scale) / TILE)
    const bottom = Math.floor(((box.y + box.height + spare) * this.#scale) / TILE)

    if ((right - left + 1) * (bottom - top + 1) > this.#tiles.size) {
      for (const tile of this.#tiles.values()) {
        const { across, down } = tile
        if (across >= left && across <= right && down >= top && down <= bottom) visit(tile)
      }
      return
    }

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) {
        const tile = this.#tiles.get(keyOf(across, down))
        if (tile) visit(tile)
      }
    }
  }

  #follow(strokes: readonly InkStroke[]) {
    const was = this.#strokes
    this.#strokes = strokes

    const grew = grewFrom(was, strokes)
    let gone: InkStroke[] = []
    let added: InkStroke[]

    if (grew) {
      added = strokes.slice(was.length)
      for (const stroke of added) {
        const kind = inkKind(stroke)
        if (!this.#order.has(kind)) this.#order.set(kind, this.#order.size)
      }
    } else {
      const delta = changed(was, strokes)
      gone = delta.gone
      added = delta.added

      const order = firstSeen(strokes)
      if (!sameOrder(this.#order, order)) {
        for (const tile of this.#tiles.values()) tile.stale = true
      }
      this.#order = order
    }

    const mark = (stroke: InkStroke, tile: Tile) => {
      const patch = this.#patch(tile, strokeBox(stroke))
      if (!patch) return

      tile.patches.push(patch)
      if (tile.patches.length > MOST_PATCHES) tile.patches = [bounds(tile.patches)]
    }

    for (const stroke of gone) {
      this.#grid.remove(stroke)
      this.#touched(strokeBox(stroke), (tile) => mark(stroke, tile))
    }

    if (gone.length && this.#filed < this.#unfiled.length) {
      const left = new Set(gone)
      this.#unfiled = this.#unfiled.slice(this.#filed).filter((stroke) => !left.has(stroke))
      this.#filed = 0
    }
    for (const stroke of added) this.#unfiled.push(stroke)

    if (!this.#tiles.size) return
    for (const stroke of added) {
      this.#touched(strokeBox(stroke), (tile) => {
        mark(stroke, tile)
        tile.adds.push(stroke)
      })
    }
  }

  #file(): number {
    let spent = 0
    const queue = this.#unfiled

    while (this.#filed < queue.length && spent + FILE_WEIGHT <= FILLED_A_FRAME) {
      const stroke = queue[this.#filed++]
      if (stroke) this.#grid.add(stroke)
      spent += FILE_WEIGHT
    }

    if (this.#filed === queue.length) {
      this.#unfiled = []
      this.#filed = 0
    }

    return spent
  }

  #wanted(view: View): Spot[] {
    const box = seen(view)
    const scale = this.#scale
    const left = Math.floor((box.x * scale) / TILE)
    const right = Math.ceil(((box.x + box.width) * scale) / TILE) - 1
    const top = Math.floor((box.y * scale) / TILE)
    const bottom = Math.ceil(((box.y + box.height) * scale) / TILE) - 1

    const middleAcross = (view.camera.x * scale) / TILE - 0.5
    const middleDown = (view.camera.y * scale) / TILE - 0.5
    const out: (Spot & { far: number })[] = []

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) {
        out.push({ across, down, far: (across - middleAcross) ** 2 + (down - middleDown) ** 2 })
      }
    }

    return out.sort((one, other) => one.far - other.far)
  }

  #urgency(spot: Spot): number {
    const tile = this.#tiles.get(keyOf(spot.across, spot.down))
    if (!tile) return 1
    if (tile.patches.length) return 0
    return tile.stale ? 2 : 3
  }

  #fill(wanted: readonly Spot[], palette: Palette): boolean {
    const started = performance.now()
    let spent = this.#file()
    if (this.#unfiled.length) return true

    const late = () => performance.now() - started >= FRAME_TIME

    const ready = (strokes: readonly InkStroke[]) => {
      let unready = 0
      for (const stroke of strokes) {
        if (outlined(stroke)) continue
        if (spent + OUTLINE_WEIGHT <= FILLED_A_FRAME && (!spent || !late())) {
          pathOf(stroke)
          spent += OUTLINE_WEIGHT
        } else {
          unready++
        }
      }

      return unready === 0
    }

    const affords = (cost: number) => !spent || (spent + cost <= FILLED_A_FRAME && !late())

    const order = [...wanted].sort((one, other) => this.#urgency(one) - this.#urgency(other))

    for (const spot of order) {
      const tile = this.#tiles.get(keyOf(spot.across, spot.down))

      if (tile?.patches.length) {
        const patches = tile.patches
        const members = patches.map((patch) => this.#grid.near(this.#plane(tile, patch)))
        const cost = members.reduce((sum, one) => sum + one.length, 0)
        if (!ready(members.flat()) || !affords(cost)) continue

        patches.forEach((patch, at) => this.#repair(tile, patch, members[at] ?? [], palette))
        tile.patches = []
        tile.adds = []
        spent += cost
        continue
      }

      if (tile && !tile.stale) continue

      const members = this.#grid.near(this.#plane(spot, WHOLE))
      if (!ready(members) || !affords(members.length)) continue

      this.#paintTile(spot, tile, members, palette)
      spent += members.length
    }

    let left = false
    for (const spot of wanted) {
      const tile = this.#tiles.get(keyOf(spot.across, spot.down))
      if (!tile) {
        left = true
        continue
      }

      if (tile.adds.length) this.#layOver(tile, palette)
      if (tile.stale || tile.patches.length) left = true
    }

    return left
  }

  #paintTile(spot: Spot, held: Tile | undefined, members: readonly InkStroke[], palette: Palette) {
    const tile: Tile = held ?? {
      across: spot.across,
      down: spot.down,
      surface: null,
      stale: false,
      patches: [],
      adds: [],
      used: this.#repaints,
    }
    this.#tiles.set(keyOf(spot.across, spot.down), tile)
    tile.stale = false
    tile.patches = []
    tile.adds = []

    if (!members.length) {
      this.#release(tile)
      return
    }

    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    wipe(ctx, TILE, TILE)
    this.#onto(ctx, tile)
    fillInk(ctx, members, palette, this.#rank)
    plain(ctx)
  }

  #repair(tile: Tile, patch: Patch, members: readonly InkStroke[], palette: Palette) {
    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    const wide = patch.right - patch.left
    const tall = patch.bottom - patch.top
    plain(ctx)
    ctx.clearRect(patch.left, patch.top, wide, tall)

    if (!members.length) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(patch.left, patch.top, wide, tall)
    ctx.clip()
    this.#onto(ctx, tile)
    fillInk(ctx, members, palette, this.#rank)
    ctx.restore()
    plain(ctx)
  }

  #surfaceOf(tile: Tile): Paintable | null {
    if (tile.surface) return tile.surface.context

    const spare = this.#spare.pop()
    if (spare) wipe(spare.context, TILE, TILE)
    tile.surface = spare ?? this.#make(TILE)
    return tile.surface?.context ?? null
  }

  readonly #rank = (kind: string) => this.#order.get(kind) ?? this.#order.size

  #onto(ctx: Paintable, tile: Spot) {
    const scale = this.#scale
    ctx.setTransform(scale, 0, 0, scale, -tile.across * TILE, -tile.down * TILE)
  }

  #layOver(tile: Tile, palette: Palette) {
    const adds = tile.adds
    tile.adds = []

    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    this.#onto(ctx, tile)
    fillInk(ctx, adds, palette, this.#rank)
    plain(ctx)
  }

  #compose(ctx: CanvasRenderingContext2D, wanted: readonly Spot[], view: View) {
    const at = origin(view)
    const width = view.width * view.ratio
    const height = view.height * view.ratio
    const was = this.#painted

    const missing = wanted.filter(({ across, down }) => !this.#tiles.has(keyOf(across, down)))
    const kept = missing.length > 0 && was?.width === width && was.height === height ? was : null

    if (kept) {
      const scale = this.#scale / kept.scale
      plain(ctx)
      ctx.save()
      ctx.beginPath()
      for (const { across, down } of missing) {
        ctx.rect(across * TILE + at.x, down * TILE + at.y, TILE, TILE)
      }
      ctx.clip()
      ctx.globalCompositeOperation = 'copy'
      ctx.setTransform(scale, 0, 0, scale, at.x - kept.x * scale, at.y - kept.y * scale)
      ctx.drawImage(ctx.canvas, 0, 0)
      ctx.restore()
      plain(ctx)
    } else {
      wipe(ctx, width, height)
    }

    for (const { across, down } of wanted) {
      const tile = this.#tiles.get(keyOf(across, down))
      if (!tile) continue

      tile.used = this.#repaints
      const x = across * TILE + at.x
      const y = down * TILE + at.y
      if (kept) ctx.clearRect(x, y, TILE, TILE)
      if (tile.surface) ctx.drawImage(tile.surface.image, x, y)
    }

    this.#painted = { scale: this.#scale, x: at.x, y: at.y, width, height }
  }

  #letGo(wanted: readonly Spot[]) {
    const most = Math.max(16, wanted.length * KEPT)
    if (this.#tiles.size <= most) return

    const oldest = [...this.#tiles.entries()]
      .filter(([, tile]) => tile.used < this.#repaints)
      .sort(([, one], [, other]) => one.used - other.used)

    for (const [key, tile] of oldest.slice(0, this.#tiles.size - most)) {
      this.#release(tile)
      this.#tiles.delete(key)
    }
  }

  #release(tile: Tile) {
    if (tile.surface && this.#spare.length < 64) this.#spare.push(tile.surface)
    tile.surface = null
  }
}
