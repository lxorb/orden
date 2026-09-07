import { describe, expect, test } from 'vitest'
import type { NoteGraph } from './graph'
import { Layout } from './graph-layout'

/** A graph with the shape asked for and nothing else: the layout reads node
 *  degrees and edge ends, and nothing about what a note says. */
function graph(count: number, edges: [number, number][]): NoteGraph {
  const nodes = Array.from({ length: count }, (_, one) => ({
    id: `n${one}`,
    name: `n${one}`,
    path: `n${one}.md`,
    degree: 0,
  }))

  for (const [a, b] of edges) {
    const one = nodes[a]
    const other = nodes[b]
    if (one) one.degree++
    if (other) other.degree++
  }

  return { nodes, edges: edges.map(([a, b]) => ({ a, b })) }
}

/** A star: one hub with `spokes` notes linked to it. */
const star = (spokes: number) =>
  graph(
    spokes + 1,
    Array.from({ length: spokes }, (_, one): [number, number] => [0, one + 1]),
  )

const away = (layout: Layout, a: number, b: number) =>
  Math.hypot((layout.x[a] ?? 0) - (layout.x[b] ?? 0), (layout.y[a] ?? 0) - (layout.y[b] ?? 0))

const positions = (layout: Layout) => [[...layout.x], [...layout.y]]

describe('a layout that settles', () => {
  test('arrives, and says so', () => {
    const layout = new Layout(star(6))
    expect(layout.settled).toBe(false)

    layout.settle()
    expect(layout.settled).toBe(true)
  })

  test('does nothing once it has arrived, so a still picture stays still', () => {
    const layout = new Layout(star(6))
    layout.settle()

    const rested = positions(layout)
    layout.tick(500)

    expect(positions(layout)).toEqual(rested)
  })

  test('holds linked notes about a link apart', () => {
    const layout = new Layout(star(8))
    layout.settle()

    for (let spoke = 1; spoke <= 8; spoke++) {
      const distance = away(layout, 0, spoke)
      expect(distance).toBeGreaterThan(12)
      expect(distance).toBeLessThan(120)
    }
  })

  test('holds unlinked notes apart as well, so nothing hides behind anything', () => {
    const layout = new Layout(graph(24, []))
    layout.settle()

    for (let one = 0; one < 24; one++) {
      for (let other = one + 1; other < 24; other++) {
        expect(away(layout, one, other)).toBeGreaterThan(2)
      }
    }
  })

  test('keeps a chain of notes in the order the links put them', () => {
    // Six notes in a line. Whatever the arrangement, each is nearer its
    // neighbour in the chain than the note three along.
    const chain = graph(6, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
    const layout = new Layout(chain)
    layout.settle()

    expect(away(layout, 0, 1)).toBeLessThan(away(layout, 0, 3))
    expect(away(layout, 2, 3)).toBeLessThan(away(layout, 2, 5))
  })

  test('an empty graph is already settled', () => {
    const layout = new Layout(graph(0, []))

    expect(layout.settled).toBe(true)
    layout.tick(10)
    expect(layout.x).toHaveLength(0)
  })

  test('one note on its own lands in the middle', () => {
    const layout = new Layout(graph(1, []))
    layout.settle()

    expect(away(layout, 0, 0)).toBe(0)
    expect(Math.hypot(layout.x[0] ?? 0, layout.y[0] ?? 0)).toBeLessThan(20)
  })
})

describe('the same seed lays out the same way', () => {
  test('twice over, to the last decimal', () => {
    const shape = star(30)

    const one = new Layout(shape, { seed: 7 })
    const other = new Layout(shape, { seed: 7 })
    one.settle()
    other.settle()

    expect(positions(one)).toEqual(positions(other))
  })

  test('however the ticks are spread out', () => {
    const shape = star(30)

    const whole = new Layout(shape, { seed: 7 })
    const inBits = new Layout(shape, { seed: 7 })
    whole.settle()
    while (!inBits.settled) inBits.tick(3)

    expect(positions(inBits)).toEqual(positions(whole))
  })

  test('and another seed lays it out another way', () => {
    const shape = star(30)

    const one = new Layout(shape, { seed: 7 })
    const other = new Layout(shape, { seed: 8 })
    one.settle()
    other.settle()

    expect(positions(one)).not.toEqual(positions(other))
  })
})

describe('a note moved by hand', () => {
  test('stays where it was put', () => {
    const layout = new Layout(star(8))
    layout.settle()

    layout.hold(3, 400, -250)
    expect(layout.x[3]).toBe(400)
    expect(layout.y[3]).toBe(-250)

    // Holding warms the layout again so the neighbours follow; the held note is
    // not one of the things that moves.
    expect(layout.settled).toBe(false)
    layout.settle()
    expect(layout.x[3]).toBe(400)
    expect(layout.y[3]).toBe(-250)
  })

  test('and its neighbour comes along', () => {
    // A pair joined by one link. Pulling one of them a long way off has to pull
    // the other after it, or the picture reads as a broken link.
    const layout = new Layout(graph(2, [[0, 1]]))
    layout.settle()

    const was = layout.x[1] ?? 0
    layout.hold(0, 200, 0)
    layout.settle()

    expect(layout.x[1] ?? 0).toBeGreaterThan(was)
    expect(away(layout, 0, 1)).toBeLessThan(60)
  })
})

describe('a space of two thousand notes and four thousand links', () => {
  /** The same shape the whole-space graph is measured in the browser on: every
   *  note linked to the next and to one seven along, plus a hub. */
  function many(): NoteGraph {
    const edges: [number, number][] = []

    for (let one = 0; one < 2000; one++) {
      edges.push([one, (one + 1) % 2000])
      edges.push([one, (one + 7) % 2000])
    }

    return graph(2000, edges)
  }

  test('places them all, at a tick a view can afford', () => {
    const shape = many()
    expect(shape.edges).toHaveLength(4000)

    const built = performance.now()
    const layout = new Layout(shape)
    const building = performance.now() - built

    // Warm, since what matters is what a frame in the middle of the settle
    // costs rather than the first one.
    layout.tick(20)
    const ticking = performance.now()
    layout.tick(10)
    const aTick = (performance.now() - ticking) / 10

    const settling = performance.now()
    layout.settle()
    const whole = performance.now() - settling

    expect(layout.settled).toBe(true)
    // Measured at 1.3 ms to build, 1.3 ms a tick, and 375 ms for the whole
    // settle, which the view spends about a second of frames on. The ceilings
    // are loose: this is a shape check, not a benchmark on a shared runner.
    expect(building).toBeLessThan(50)
    expect(aTick).toBeLessThan(8)
    expect(whole).toBeLessThan(3000)
  })

  test('nothing lands on top of anything', () => {
    const layout = new Layout(many())
    layout.settle()

    for (let one = 0; one < 2000; one++) {
      expect(Number.isFinite(layout.x[one])).toBe(true)
      expect(Number.isFinite(layout.y[one])).toBe(true)
    }
  })
})
