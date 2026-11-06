import { describe, expect, test } from 'vitest'
import { GRID } from './geometry'
import { snapMove, snapPoint, snapResize } from './snap'

const box = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height })

describe('a card dragged in open space', () => {
  test('lands on the grid', () => {
    const snap = snapMove(box(103, 47), [])

    expect(snap.dx).toBe(-3)
    expect(snap.dy).toBe(-7)
    expect(snap.guides).toEqual([])
  })

  test('one already on the grid is left where it is', () => {
    expect(snapMove(box(GRID * 3, GRID * 2), [])).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})

describe('a card dragged near another', () => {
  test('lines its left edge up with the other one, not with the grid', () => {
    const snap = snapMove(box(103, 400), [box(100, 0)])

    expect(snap.dx).toBe(-3)
    expect(snap.guides).toContainEqual({ axis: 'x', at: 100, from: 0, to: 500 })
  })

  test('lines its middle up with the middle of the other one', () => {
    const snap = snapMove(box(98, 400), [box(100, 0)])
    expect(snap.dx).toBe(2)
  })

  test('lines its left edge up with the right edge of the other one', () => {
    const snap = snapMove(box(203, 400), [box(100, 0)])
    expect(snap.dx).toBe(-3)
  })

  test('is not pulled by something too far away', () => {
    const snap = snapMove(box(103, 400), [box(500, 0)])

    expect(snap.dx).toBe(-3)
    expect(snap.guides).toEqual([])
  })

  test('takes the nearer of two neighbours', () => {
    const snap = snapMove(box(104, 400), [box(100, 0), box(105, 0)])
    expect(snap.dx).toBe(1)
  })

  test('lines up on one axis and falls back to the grid on the other', () => {
    const snap = snapMove(box(102, 47), [box(100, 900)])

    expect(snap.dx).toBe(-2)
    expect(snap.dy).toBe(-7)
    expect(snap.guides).toHaveLength(1)
  })

  test('the guide reaches past both of them, so it says which two lined up', () => {
    const [guide] = snapMove(box(100, 400), [box(100, 0)]).guides

    expect(guide).toMatchObject({ axis: 'x', at: 100, from: 0, to: 500 })
  })
})

describe('a card being resized', () => {
  test('lands its own pulled edge on the grid', () => {
    const snap = snapResize(box(100, 100, 207, 100), 'e', [])

    expect(snap.dx).toBe(-7)
    expect(snap.dy).toBe(0)
  })

  test('leaves the edges the handle is not pulling alone', () => {
    expect(snapResize(box(103, 107, 200, 200), 'e', []).dy).toBe(0)
    expect(snapResize(box(103, 107, 200, 200), 's', []).dx).toBe(0)
  })

  test('lines the pulled edge up with a neighbour rather than the grid', () => {
    const snap = snapResize(box(0, 0, 98, 100), 'e', [box(100, 300)])

    expect(snap.dx).toBe(2)
    expect(snap.guides).toHaveLength(1)
  })

  test('a corner pulls both of its edges', () => {
    const snap = snapResize(box(103, 107, 200, 200), 'nw', [])

    expect(snap.dx).toBe(-3)
    expect(snap.dy).toBe(-7)
  })
})

describe('a corner being dragged out', () => {
  test('lands on the grid in open space', () => {
    const snap = snapPoint({ x: 103, y: 47 }, [])

    expect(snap.dx).toBe(-3)
    expect(snap.dy).toBe(-7)
    expect(snap.guides).toEqual([])
  })

  test('lines up with an edge of something already on the plane', () => {
    const snap = snapPoint({ x: 197, y: 47 }, [box(300, 0, 100, 100)])

    expect(snap.dx).toBe(3)

    const nearer = snapPoint({ x: 296, y: 47 }, [box(300, 0, 100, 100)])
    expect(nearer.dx).toBe(4)
    expect(nearer.guides.some((one) => one.axis === 'x' && one.at === 300)).toBe(true)
  })

  test('lines up with the middle of something, not just its edges', () => {
    const snap = snapPoint({ x: 348, y: 400 }, [box(300, 0, 100, 100)])
    expect(snap.dx).toBe(2)
  })

  test('draws its line from the point to the thing it lined up with', () => {
    const snap = snapPoint({ x: 296, y: 400 }, [box(300, 0, 100, 100)])
    const guide = snap.guides.find((one) => one.axis === 'x')

    expect(guide?.from).toBe(0)
    expect(guide?.to).toBe(400)
  })
})
