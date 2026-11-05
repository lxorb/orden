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

test('two fingers scrolling zoom about the pointer and never move it, Ctrl or not', () => {
  for (const ctrlKey of [false, true]) {
    const nearer = turned(still, { ...turn, deltaX: 30, deltaY: -10, ctrlKey, x: 300, y: 200 })
    expect(nearer.zoom).toBeGreaterThan(1)
    const under = toCanvas(nearer, { x: 300, y: 200 })
    expect(under.x).toBeCloseTo(300)
    expect(under.y).toBeCloseTo(200)
    expect(turned(still, { ...turn, deltaY: 10, ctrlKey }).zoom).toBeLessThan(1)
  }
  // Sideways alone neither zooms nor moves it.
  expect(turned(still, { ...turn, deltaX: 30 })).toEqual(still)
  // A wheel that counts in lines zooms by as many pixels' worth.
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
  // Two notches in quick succession aim twice as far, not from where it has got to.
  const goal = notched(notched(1, notch), notch)
  expect(goal).toBeCloseTo(Math.exp(0.4))
  // On its way there frame by frame: never past it, never back, the pointer's point
  // still under the pointer, and there within half a second.
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
  // The first frame already moves: no wait before it starts.
  expect(eased(still, goal, { x: 0, y: 0 }, 1 / 60).zoom).toBeGreaterThan(1.05)
})

test('a box is on view while its middle is, at the camera’s own zoom', () => {
  const room = { x: 0, y: 0, w: 1000, h: 800 }
  const box = { x: 1500, y: 100, w: 700, h: 400 }
  expect(isOnView(still, box, room)).toBe(false)
  expect(isOnView({ x: -1500, y: 0, zoom: 1 }, box, room)).toBe(true)
  expect(isOnView({ x: 0, y: 0, zoom: 0.4 }, box, room)).toBe(true)
  // A sliver at the edge is not somewhere to open at.
  expect(isOnView({ x: -600, y: 0, zoom: 1 }, box, room)).toBe(false)
})

test('fingers handed over in few, large turns are followed smoothly, frame by frame', () => {
  // Emil, round 4: smooth in Firefox, in steps in the app. WebView2 can hand a touchpad's
  // fingers over a dozen times a second in turns of tens of pixels, and a mouse's wheel in
  // lines; each turn aims the zoom, and the camera eases there a frame at a time.
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
      // A turn every sixth frame, ten a second, for the first half second.
      if (frame % 6 === 0 && frame < 30) goal = aimed(goal.zoom, turn)
      const next = eased(camera, goal.zoom, at, 1 / 60, goal.ease)
      sharpest = Math.max(sharpest, Math.abs(Math.log(next.zoom / camera.zoom)))
      camera = next
    }
    expect(camera.zoom).toBeCloseTo(goal.zoom, 2)
    expect(camera.zoom).toBeGreaterThan(0.5)
    // No frame is a leap: each is well under what the same turn all at once would be.
    const leap = Math.abs(Math.log(aimed(0.5, turn).zoom / 0.5))
    expect(sharpest).toBeLessThan(leap * 0.5)
  }
})
