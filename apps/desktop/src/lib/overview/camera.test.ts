import { expect, test } from 'vitest'
import {
  boxToCanvas,
  FARTHEST,
  lookingAt,
  NEAREST,
  pinched,
  showing,
  toCanvas,
  turned,
  zoomedAt,
} from './camera'

const still = { x: 0, y: 0, zoom: 1 }
const turn = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, x: 0, y: 0 }

test('opens with the space’s place filling the room, one to one', () => {
  const camera = lookingAt({ x: 2000, y: 0, w: 800, h: 600 }, { x: 56, y: 88, w: 800, h: 600 })
  expect(toCanvas(camera, { x: 56, y: 88 })).toEqual({ x: 2000, y: 0 })
  // Placed in a larger window than this one: all of it, smaller, in the middle.
  const smaller = lookingAt({ x: 0, y: 0, w: 1600, h: 600 }, { x: 0, y: 0, w: 800, h: 600 })
  expect(smaller.zoom).toBe(0.5)
  expect(toCanvas(smaller, { x: 0, y: 150 })).toEqual({ x: 0, y: 0 })
})

test('two fingers or the wheel move it, as far as they went', () => {
  expect(turned(still, { ...turn, deltaX: 30, deltaY: -10 })).toEqual({ x: -30, y: 10, zoom: 1 })
  // A wheel that counts in lines.
  expect(turned(still, { ...turn, deltaY: 1, deltaMode: 1 }).y).toBe(-40)
})

test('a pinch brings it nearer about the pointer, which stays put', () => {
  const nearer = turned(still, { ...turn, deltaY: -50, ctrlKey: true, x: 300, y: 200 })
  expect(nearer.zoom).toBeGreaterThan(1)
  const under = toCanvas(nearer, { x: 300, y: 200 })
  expect(under.x).toBeCloseTo(300)
  expect(under.y).toBeCloseTo(200)
})

test('never nearer or further than it can be read', () => {
  expect(zoomedAt(still, { x: 0, y: 0 }, 100).zoom).toBe(NEAREST)
  expect(zoomedAt(still, { x: 0, y: 0 }, 0.001).zoom).toBe(FARTHEST)
})

test('two fingers on glass move by their middle and zoom by their spread', () => {
  const after = pinched(
    still,
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
    [
      { x: 50, y: 100 },
      { x: 250, y: 100 },
    ],
  )
  expect(after.zoom).toBeCloseTo(2)
  expect(toCanvas(after, { x: 150, y: 100 }).x).toBeCloseTo(150)
})

test('a window walked to off screen is brought just into view', () => {
  const room = { x: 0, y: 0, w: 1000, h: 800 }
  expect(showing(still, { x: 1100, y: 10, w: 200, h: 100 }, room)).toEqual({
    x: -300,
    y: 0,
    zoom: 1,
  })
  expect(showing(still, { x: 10, y: 10, w: 200, h: 100 }, room)).toEqual(still)
  expect(boxToCanvas({ x: 10, y: 0, zoom: 2 }, { x: 30, y: 20, w: 100, h: 50 })).toEqual({
    x: 10,
    y: 10,
    w: 50,
    h: 25,
  })
})
