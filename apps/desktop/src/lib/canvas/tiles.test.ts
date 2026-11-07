import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'

class CountingPath {
  static traced = 0

  moveTo() {
    CountingPath.traced += 1
  }

  quadraticCurveTo() {
    return undefined
  }

  closePath() {
    return undefined
  }

  addPath() {
    return undefined
  }
}

const filling = vi.hoisted(() => ({ strokes: [] as InkStroke[] }))

vi.mock('./paint', async (original) => {
  const paint = await original<typeof import('./paint')>()
  return {
    ...paint,
    fillInk: (...args: Parameters<typeof paint.fillInk>) => {
      const [ctx, strokes, palette, rank] = args
      filling.strokes = [...strokes]
      paint.fillInk(ctx, filling.strokes, palette, rank)
    },
  }
})

beforeAll(() => {
  vi.stubGlobal('Path2D', CountingPath)
  vi.spyOn(performance, 'now').mockReturnValue(0)
})

const { FILE_WEIGHT, FILLED_A_FRAME, InkTiles, OUTLINE_WEIGHT, TILE } = await import('./tiles')
const { InkGrid } = await import('./ink-grid')
const { strokesFilled } = await import('./paint')

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

type Mark =
  | { kind: 'clear'; rect: Rect }
  | { kind: 'fill'; rect: Rect; strokes: InkStroke[]; scale: number; x: number; y: number }

function context() {
  const marks: Mark[] = []
  const colours: string[] = []
  const copies: { image: unknown; x: number; y: number; scale: number }[] = []
  const transform = { a: 1, e: 0, f: 0 }
  let outline: Rect | null = null
  let clip: Rect | null = null
  const self = {} as unknown as HTMLCanvasElement
  const all = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }

  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    canvas: self,
    setTransform: (a: number, _b: number, _c: number, _d: number, e: number, f: number) => {
      Object.assign(transform, { a, e, f })
    },
    clearRect: (x: number, y: number, wide: number, tall: number) => {
      marks.push({ kind: 'clear', rect: { left: x, top: y, right: x + wide, bottom: y + tall } })
    },
    createPattern: () => null,
    save: () => undefined,
    restore: () => {
      clip = null
    },
    beginPath: () => {
      outline = null
    },
    rect: (x: number, y: number, wide: number, tall: number) => {
      outline = { left: x, top: y, right: x + wide, bottom: y + tall }
    },
    clip: () => {
      clip = outline
    },
    fill: () => {
      colours.push(ctx.fillStyle)
      if (!filling.strokes.length) return
      marks.push({
        kind: 'fill',
        rect: clip ?? all,
        strokes: filling.strokes,
        scale: transform.a,
        x: transform.e,
        y: transform.f,
      })
      filling.strokes = []
    },
    stroke: () => undefined,
    drawImage: (image: unknown, x: number, y: number) => {
      copies.push({ image, x, y, scale: transform.a })
    },
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, marks, colours, copies, self }
}

function surfaces() {
  const made: ReturnType<typeof context>[] = []
  const make = () => {
    const one = context()
    made.push(one)
    return { image: one.self, context: one.ctx }
  }

  return { made, make }
}

function reaches(stroke: InkStroke, px: number, py: number, scale: number, x: number, y: number) {
  const box = strokeBox(stroke)
  const middle = { x: px + 0.5, y: py + 0.5 }
  return (
    middle.x >= box.x * scale + x - 1 &&
    middle.x <= (box.x + box.width) * scale + x + 1 &&
    middle.y >= box.y * scale + y - 1 &&
    middle.y <= (box.y + box.height) * scale + y + 1
  )
}

const inside = (rect: Rect, px: number, py: number) =>
  px >= rect.left && px < rect.right && py >= rect.top && py < rect.bottom

function shown(marks: readonly Mark[], px: number, py: number): string[] {
  const out = new Set<string>()
  for (let at = marks.length - 1; at >= 0; at--) {
    const mark = marks[at]
    if (!mark || !inside(mark.rect, px, py)) continue
    if (mark.kind === 'clear') break
    for (const stroke of mark.strokes) {
      if (reaches(stroke, px, py, mark.scale, mark.x, mark.y)) out.add(stroke.id)
    }
  }

  return [...out].sort()
}

function check(
  made: ReturnType<typeof surfaces>['made'],
  strokes: readonly InkStroke[],
  at: ReturnType<typeof view>,
  gone: readonly InkStroke[] = [],
) {
  const scale = at.camera.scale * at.ratio
  const held = new Map<string, Mark[]>()

  for (const one of made) {
    let wiped = 0
    one.marks.forEach((mark, at) => {
      const { left, top, right, bottom } = mark.rect
      if (mark.kind === 'clear' && left <= 0 && top <= 0 && right >= TILE && bottom >= TILE) {
        wiped = at
      }
    })

    const since = one.marks.slice(wiped)
    const last = since.filter((mark) => mark.kind === 'fill').at(-1)
    if (last?.kind !== 'fill') continue
    held.set(`${-last.x / TILE},${-last.y / TILE}`, since)
  }

  const middle = (stroke: InkStroke, across: number, down: number) => {
    const box = strokeBox(stroke)
    return [
      Math.floor((box.x + box.width / 2) * scale - across * TILE),
      Math.floor((box.y + box.height / 2) * scale - down * TILE),
    ] as const
  }

  for (const tile of expected(strokes, at).keys()) {
    const marks = held.get(tile)
    expect(marks, `tile ${tile} has no pixels`).toBeDefined()
    if (!marks) continue

    const [across = 0, down = 0] = tile.split(',').map(Number)
    const x = -across * TILE
    const y = -down * TILE
    const near = strokes.filter((one) => reachesTile(one, scale, x, y))

    const samples: (readonly [number, number])[] = []
    for (let py = 0; py < TILE; py += 16)
      for (let px = 0; px < TILE; px += 16) samples.push([px, py])
    for (const one of [...near, ...gone]) samples.push(middle(one, across, down))

    for (const [px, py] of samples) {
      if (px < 0 || py < 0 || px >= TILE || py >= TILE) continue
      const truth = near
        .filter((one) => reaches(one, px, py, scale, x, y))
        .map((one) => one.id)
        .sort()
      expect(shown(marks, px, py), `tile ${tile} at ${px},${py}`).toEqual(truth)
    }
  }
}

function reachesTile(stroke: InkStroke, scale: number, x: number, y: number) {
  const box = strokeBox(stroke)
  return (
    box.x * scale + x - 1 < TILE &&
    (box.x + box.width) * scale + x + 1 > 0 &&
    box.y * scale + y - 1 < TILE &&
    (box.y + box.height) * scale + y + 1 > 0
  )
}

function plane(count: number, across = 100, spacing = 120): InkStroke[] {
  const strokes: InkStroke[] = []

  for (let one = 0; one < count; one++) {
    const x = (one % across) * spacing
    const y = Math.floor(one / across) * spacing
    const points = []
    for (let step = 0; step < 6; step++) {
      points.push({
        x: x + step * 8,
        y: y + step * 2,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 10,
      })
    }

    strokes.push({ id: `s${one}`, tool: 'pen', color: 'ink', size: 3, points })
  }

  return strokes
}

function drawn(id: string, x: number, y: number, tool: InkStroke['tool'] = 'pen'): InkStroke {
  return {
    id,
    tool,
    color: 'ink',
    size: 3,
    points: [0, 1, 2, 3].map((step) => ({
      x: x + step * 10,
      y,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: step * 10,
    })),
  }
}

const view = (x: number, y: number, scale = 1) => ({
  camera: { x, y, scale },
  width: 800,
  height: 600,
  ratio: 1,
})

const whole = view(6000, 6000, 0.05)

const palette = {}

function settle(paint: () => boolean, most = 400): number[] {
  const each: number[] = []
  for (let frame = 0; frame < most; frame++) {
    const before = strokesFilled()
    const owed = paint()
    each.push(strokesFilled() - before)
    if (!owed) return each
  }

  throw new Error('the ink never finished arriving')
}

const sum = (list: readonly number[]) => list.reduce((all, one) => all + one, 0)

function expected(strokes: readonly InkStroke[], at: ReturnType<typeof view>): Map<string, number> {
  const scale = at.camera.scale * at.ratio
  const side = TILE / scale
  const spare = 1 / scale
  const seen = {
    x: at.camera.x - at.width / 2 / at.camera.scale,
    y: at.camera.y - at.height / 2 / at.camera.scale,
    width: at.width / at.camera.scale,
    height: at.height / at.camera.scale,
  }

  const meets = (one: Box, other: Box) =>
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height

  const out = new Map<string, number>()
  for (
    let across = Math.floor((seen.x * scale) / TILE);
    across * side < seen.x + seen.width;
    across++
  ) {
    for (
      let down = Math.floor((seen.y * scale) / TILE);
      down * side < seen.y + seen.height;
      down++
    ) {
      const box = {
        x: across * side - spare,
        y: down * side - spare,
        width: side + 2 * spare,
        height: side + 2 * spare,
      }
      const count = strokes.filter((one) => meets(strokeBox(one), box)).length
      if (count) out.set(`${across},${down}`, count)
    }
  }

  return out
}

describe('a plane seen whole, arriving', () => {
  test('fills a frame of budget at a time, and every tile is filled once', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    const frames: number[] = []
    const outlines: number[] = []
    const filings: number[] = []
    const filing = vi.spyOn(InkGrid.prototype, 'add')
    for (let owed = true; owed;) {
      const filled = strokesFilled()
      const traced = CountingPath.traced
      const filed = filing.mock.calls.length
      owed = tiles.paint(layer.ctx, strokes, whole, palette)
      frames.push(strokesFilled() - filled)
      outlines.push(CountingPath.traced - traced)
      filings.push(filing.mock.calls.length - filed)
      if (frames.length > 400) throw new Error('the ink never finished arriving')
    }
    filing.mockRestore()

    expect(frames.length).toBeGreaterThan(1)
    frames.forEach((filled, at) => {
      const outlined = (outlines[at] ?? 0) * OUTLINE_WEIGHT
      expect(filled + outlined + (filings[at] ?? 0) * FILE_WEIGHT).toBeLessThanOrEqual(
        FILLED_A_FRAME,
      )
    })

    expect(sum(filings)).toBe(strokes.length)
    expect(sum(outlines)).toBe(strokes.length)
    expect(sum(frames)).toBe(sum([...expected(strokes, whole).values()]))
  })

  test('every tile of a plane seen whole shows what is on it, and nothing else', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))
    check(made, strokes, whole)
  })

  test('a plane that fits in a frame arrives in one', () => {
    const strokes = plane(200, 20)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    expect(settle(() => tiles.paint(layer.ctx, strokes, view(1000, 1000), palette))).toHaveLength(1)
  })

  test('a machine too slow for a frame of budget stops filling when the frame is spent, and the rest follow', () => {
    const strokes = plane(200, 20)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    const at = view(1000, 1000)

    let clock = 0
    const ticking = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 4))
    try {
      expect(settle(() => tiles.paint(layer.ctx, strokes, at, palette)).length).toBeGreaterThan(1)
    } finally {
      ticking.mockReturnValue(0)
    }
    check(made, strokes, at)
  })
})

describe('moving over a plane already painted', () => {
  test('a pan back and forth over painted plane fills nothing', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(3000, 3000), palette))
    settle(() => tiles.paint(layer.ctx, strokes, view(3300, 3100), palette))

    const before = strokesFilled()
    for (let frame = 0; frame < 40; frame++) {
      const at = frame % 2 ? view(3000, 3000) : view(3300, 3100)
      expect(tiles.paint(layer.ctx, strokes, at, palette)).toBe(false)
    }

    expect(strokesFilled() - before).toBe(0)
  })

  test('a pan onto new plane fills only the tiles it uncovered', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const from = view(3000, 3000)
    const to = view(3600, 3000)

    settle(() => tiles.paint(layer.ctx, strokes, from, palette))
    const filled = sum(settle(() => tiles.paint(layer.ctx, strokes, to, palette)))

    const before = expected(strokes, from)
    const uncovered = sum(
      [...expected(strokes, to)].filter(([tile]) => !before.has(tile)).map(([, count]) => count),
    )

    expect(filled).toBeGreaterThan(0)
    expect(filled).toBe(uncovered)
  })

  test('shows the tiles it has, at whole pixels, where the camera puts them', () => {
    const strokes = plane(400, 20)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(1000.3, 1000.7), palette))
    layer.copies.length = 0
    tiles.paint(layer.ctx, strokes, view(1000.3, 1000.7), palette)

    expect(layer.copies.length).toBe(expected(strokes, view(1000.3, 1000.7)).size)
    for (const copy of layer.copies) {
      expect(Number.isInteger(copy.x)).toBe(true)
      expect(Number.isInteger(copy.y)).toBe(true)
    }
  })

  test('the same colours read off the theme again paint nothing again', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const at = view(3000, 3000)
    settle(() => tiles.paint(layer.ctx, strokes, at, { ink: 'black', yellow: 'gold' }))

    const before = strokesFilled()
    for (let move = 0; move < 20; move++) {
      expect(tiles.paint(layer.ctx, strokes, at, { ink: 'black', yellow: 'gold' })).toBe(false)
    }

    expect(strokesFilled() - before).toBe(0)
  })
})

describe('writing on a plane already painted', () => {
  test('a stroke drawn on a plane seen whole fills the strokes around it, not its tiles', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    const grown = [...strokes, drawn('new', TILE / 0.05 - 20, 3000)]
    const before = strokesFilled()
    expect(tiles.paint(layer.ctx, grown, whole, palette)).toBe(false)

    expect(strokesFilled() - before).toBeGreaterThan(0)
    expect(strokesFilled() - before).toBeLessThan(40)
    check(made, grown, whole)
  })

  test('a highlighter drawn over the ink is repaired with it, so each tile is one fill of both', () => {
    const strokes = plane(2_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    const at = view(2000, 1000, 0.25)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const mark = { ...drawn('mark', 1000, 500, 'highlighter'), size: 18 }
    const grown = [...strokes, mark]
    settle(() => tiles.paint(layer.ctx, grown, at, palette))

    check(made, grown, at)
  })

  test('a stroke rubbed out on a plane seen whole leaves every other stroke where it was', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    const gone = strokes.filter((one) => one.id === 's1543')
    const left = strokes.filter((one) => one.id !== 's1543')
    const before = strokesFilled()
    expect(tiles.paint(layer.ctx, left, whole, palette)).toBe(false)

    expect(strokesFilled() - before).toBeLessThan(40)
    check(made, left, whole, gone)
  })

  test('a rub across a plane seen whole costs the strokes it crosses, move by move', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    let now = strokes
    const each: number[] = []
    for (let move = 0; move < 60; move++) {
      const row = now.filter((one) => one.id !== `s${1500 + move}`)
      const before = strokesFilled()
      tiles.paint(layer.ctx, row, whole, palette)
      each.push(strokesFilled() - before)
      now = row
    }

    for (const filled of each) expect(filled).toBeLessThan(40)
    settle(() => tiles.paint(layer.ctx, now, whole, palette))
    check(made, now, whole, strokes.slice(1500, 1560))
  })

  test('a lasso that moves many strokes repairs where they were and where they went', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    const at = view(3000, 1500, 0.25)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const picked = new Set(strokes.slice(1000, 1400).map((one) => one.id))
    const moved = strokes.map((one) =>
      picked.has(one.id)
        ? {
            ...one,
            points: one.points.map((point) => ({ ...point, x: point.x + 700, y: point.y + 300 })),
          }
        : one,
    )

    const frames = settle(() => tiles.paint(layer.ctx, moved, at, palette))
    for (const filled of frames) expect(filled).toBeLessThanOrEqual(FILLED_A_FRAME)
    check(
      made,
      moved,
      at,
      strokes.filter((one) => picked.has(one.id)),
    )
  })

  test('the kinds are painted in the order the plane first has them, in every tile', () => {
    const strokes = [
      drawn('mark', 10, 10, 'highlighter'),
      drawn('word', 12, 12),
      drawn('later word', 300, 10),
      drawn('later mark', 302, 12, 'highlighter'),
    ].map((one) => (one.tool === 'highlighter' ? { ...one, color: 'yellow' } : one))
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(200, 100), { yellow: 'Y', ink: 'I' }))

    expect(made.map((one) => one.colours.join(''))).toEqual(['YI', 'YI'])
  })
})

describe('a zoom, a theme, and what is kept', () => {
  test('a zoom paints the new scale a frame at a time over the old picture, drawn to size', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    layer.copies.length = 0
    const closer = view(6000, 6000, 0.08)
    const before = strokesFilled()
    const owed = tiles.paint(layer.ctx, strokes, closer, palette)

    expect(owed).toBe(true)
    expect(strokesFilled() - before).toBeLessThanOrEqual(FILLED_A_FRAME)
    const old = layer.copies.find((copy) => copy.image === layer.self)
    expect(old?.scale).toBeCloseTo(0.08 / 0.05)

    const frames = settle(() => tiles.paint(layer.ctx, strokes, closer, palette))
    for (const filled of frames) expect(filled).toBeLessThanOrEqual(FILLED_A_FRAME)
    check(made, strokes, closer)
  })

  test('a new theme paints every tile again, showing the old ones until it has', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const at = view(3000, 3000)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const filled = sum(settle(() => tiles.paint(layer.ctx, strokes, at, { ink: 'white' })))

    expect(filled).toBe(sum([...expected(strokes, at).values()]))
  })

  test('a tile with nothing on it has no pixels', () => {
    const strokes = plane(4, 2, 2000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(1000, 1000, 0.25), palette))

    expect(made).toHaveLength(expected(strokes, view(1000, 1000, 0.25)).size)
  })

  test('keeps a couple of screens of tiles however far the plane is panned', () => {
    const strokes = plane(10_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    for (let step = 0; step < 30; step++) {
      settle(() => tiles.paint(layer.ctx, strokes, view(400 + step * 400, 3000), palette))
    }

    const screen = expected(strokes, view(3000, 3000)).size
    expect(made.length).toBeLessThanOrEqual(screen * 3 + 64)
  })
})
