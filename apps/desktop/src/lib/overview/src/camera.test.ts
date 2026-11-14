import { expect, test } from 'vitest'
import {
  boxToCanvas,
  aimed,
  eased,
  isNotch,
  notched,
  FARTHEST,
  isOnView,
  lookingAt,
  NEAREST,
  overlooking,
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
  const smaller = lookingAt({ x: 0, y: 0, w: 1600, h: 600 }, { x: 0, y: 0, w: 800, h: 600 })
  expect(smaller.zoom).toBe(0.5)
  expect(toCanvas(smaller, { x: 0, y: 150 })).toEqual({ x: 0, y: 0 })
})

test('two fingers scrolling zoom about the pointer and never move it, Ctrl or not', () => {
  for (const ctrlKey of [false, true]) {
    const nearer = turned(still, { ...turn, deltaX: 30, deltaY: -10, ctrlKey, x: 300, y: 200 })
    expect(nearer.zoom).toBeGreaterThan(1)
    const under = toCanvas(nearer, { x: 300, y: 200 })
    expect(under.x).toBeCloseTo(300)
    expect(under.y).toBeCloseTo(200)
    expect(turned(still, { ...turn, deltaY: 10, ctrlKey }).zoom).toBeLessThan(1)
  }
  expect(turned(still, { ...turn, deltaX: 30 })).toEqual(still)
  expect(turned(still, { ...turn, deltaY: 1, deltaMode: 1 }).zoom).toBeCloseTo(
    turned(still, { ...turn, deltaY: 40 }).zoom,
  )
})

test('a pinch brings it nearer about the pointer, which stays put', () => {
  const nearer = turned(still, { ...turn, deltaY: -50, ctrlKey: true, x: 300, y: 200 })
  expect(nearer.zoom).toBeGreaterThan(1)
  const under = toCanvas(nearer, { x: 300, y: 200 })
  expect(under.x).toBeCloseTo(300)
  expect(under.y).toBeCloseTo(200)
})

test('zooms out about a third further than a fifth', () => {
  expect(FARTHEST).toBeLessThanOrEqual(0.2 / 1.3 + 0.001)
  expect(FARTHEST).toBeGreaterThan(0.1)
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

test('a notch of the wheel eases to its zoom, Ctrl or not, fingers are followed', () => {
  const notch = { ...turn, deltaY: -100, ctrlKey: true, x: 300, y: 200 }
  expect(isNotch(notch)).toBe(true)
  expect(isNotch({ ...notch, ctrlKey: false })).toBe(true)
  expect(notched(1, { ...notch, ctrlKey: false })).toBe(notched(1, notch))
  expect(isNotch({ ...notch, deltaY: -3.5 })).toBe(false)
  expect(isNotch({ ...notch, deltaY: -1, deltaMode: 1 })).toBe(true)
  const goal = notched(notched(1, notch), notch)
  expect(goal).toBeCloseTo(Math.exp(0.4))
  let camera = still
  let before = camera.zoom
  for (let frame = 0; frame < 30; frame++) {
    camera = eased(camera, goal, { x: 300, y: 200 }, 1 / 60)
    expect(camera.zoom).toBeGreaterThanOrEqual(before)
    expect(camera.zoom).toBeLessThanOrEqual(goal)
    before = camera.zoom
  }
  expect(camera.zoom).toBe(goal)
  expect(toCanvas(camera, { x: 300, y: 200 }).x).toBeCloseTo(300)
  expect(eased(still, goal, { x: 0, y: 0 }, 1 / 60).zoom).toBeGreaterThan(1.05)
})

test('a box is on view while its middle is, at the camera’s own zoom', () => {
  const room = { x: 0, y: 0, w: 1000, h: 800 }
  const box = { x: 1500, y: 100, w: 700, h: 400 }
  expect(isOnView(still, box, room)).toBe(false)
  expect(isOnView({ x: -1500, y: 0, zoom: 1 }, box, room)).toBe(true)
  expect(isOnView({ x: 0, y: 0, zoom: 0.4 }, box, room)).toBe(true)
  expect(isOnView({ x: -600, y: 0, zoom: 1 }, box, room)).toBe(false)
})

test('fingers handed over in few, large turns are followed smoothly, frame by frame', () => {
  const at = { x: 300, y: 200 }
  for (const turn of [
    { deltaX: 0, deltaY: -36, deltaMode: 0, ctrlKey: false, metaKey: false, ...at },
    { deltaX: 0, deltaY: -1.5, deltaMode: 1, ctrlKey: false, metaKey: false, ...at },
    { deltaX: 0, deltaY: -40, deltaMode: 0, ctrlKey: true, metaKey: false, ...at },
    { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, ...at },
  ]) {
    let camera = { x: 0, y: 0, zoom: 0.5 }
    let goal = { zoom: camera.zoom, ease: 0.08 }
    let sharpest = 0
    for (let frame = 0; frame < 90; frame++) {
      if (frame % 6 === 0 && frame < 30) goal = aimed(goal.zoom, turn)
      const next = eased(camera, goal.zoom, at, 1 / 60, goal.ease)
      sharpest = Math.max(sharpest, Math.abs(Math.log(next.zoom / camera.zoom)))
      camera = next
    }
    expect(camera.zoom).toBeCloseTo(goal.zoom, 2)
    expect(camera.zoom).toBeGreaterThan(0.5)
    const leap = Math.abs(Math.log(aimed(0.5, turn).zoom / 0.5))
    expect(sharpest).toBeLessThan(leap * 0.5)
  }
})

test('opens further out than the space alone, never as far as everything, and never too small to read', () => {
  const room = { x: 56, y: 88, w: 1200, h: 700 }
  const here = { x: 0, y: 0, w: 1200, h: 700 }
  const whole = { x: -3600, y: -2100, w: 8400, h: 4900 }
  const alone = lookingAt(here, room).zoom
  const everything = lookingAt(whole, room).zoom
  const camera = overlooking(here, whole, room, 500)
  expect(camera.zoom).toBeLessThan(alone)
  expect(camera.zoom).toBeGreaterThan(everything)
  expect(camera.zoom * 500).toBeGreaterThanOrEqual(239.999)
  const centre = toCanvas(camera, { x: room.x + room.w / 2, y: room.y + room.h / 2 })
  expect(centre.x).toBeCloseTo(600)
  expect(centre.y).toBeCloseTo(350)
})

test('more spaces open further out, a bigger window nearer to what it holds', () => {
  const room = { x: 0, y: 0, w: 1200, h: 700 }
  const here = { x: 0, y: 0, w: 1200, h: 700 }
  const few = overlooking(here, { x: 0, y: 0, w: 2600, h: 700 }, room, 1000)
  const many = overlooking(here, { x: -2400, y: -1400, w: 6000, h: 3500 }, room, 1000)
  expect(many.zoom).toBeLessThan(few.zoom)
  const wide = overlooking(
    here,
    { x: 0, y: 0, w: 2600, h: 700 },
    { ...room, w: 2400, h: 1400 },
    1000,
  )
  expect(wide.zoom).toBeGreaterThan(few.zoom)
})

test('one space alone opens on it, and what fits is shown whole, not off to one side', () => {
  const room = { x: 0, y: 0, w: 1200, h: 700 }
  const here = { x: 100, y: 50, w: 600, h: 350 }
  expect(overlooking(here, here, room, 300)).toEqual(lookingAt(here, room))
  const whole = { x: 100, y: 50, w: 1100, h: 350 }
  const camera = overlooking(here, whole, room, 1000)
  const left = whole.x * camera.zoom + camera.x
  const right = (whole.x + whole.w) * camera.zoom + camera.x
  expect(left).toBeGreaterThanOrEqual(-0.001)
  expect(right).toBeLessThanOrEqual(room.w + 0.001)
  expect(left).toBeCloseTo(room.w - right)
})

test('opening at the edge of everything shows no empty side', () => {
  const room = { x: 0, y: 0, w: 1000, h: 600 }
  const here = { x: 0, y: 0, w: 1000, h: 600 }
  const whole = { x: 0, y: 0, w: 9000, h: 600 }
  const camera = overlooking(here, whole, room, 300)
  expect(camera.x).toBeCloseTo(0)
  expect(isOnView(camera, here, room)).toBe(true)
})
