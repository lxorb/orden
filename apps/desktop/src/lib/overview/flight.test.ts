import { expect, test } from 'vitest'
import { paneDrawn } from './flight'

function drawnAt(transform: string, box: { x: number; y: number }, px: number, py: number) {
  const [tx, ty, scale] = (
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform) ?? []
  )
    .slice(1)
    .map(Number)
  return { x: box.x + (tx ?? 0) + (scale ?? 1) * px, y: box.y + (ty ?? 0) + (scale ?? 1) * py }
}

const box = { x: 300, y: 38, width: 800, height: 640 }
const head = 40

test('at home a pane is drawn exactly where it is laid out, its strip and all', () => {
  const pose = { x: 300, y: 78, w: 800, h: 600, tab: 0, alpha: 1 }
  const drawn = paneDrawn(pose, { x: 0, y: 0, zoom: 1 }, box, head, 10, 0)
  expect(drawn.transform).toBe('translate(0px, 0px) scale(1)')
  expect(drawn.clipPath).toBe('inset(0px 0 0px 0 round 10px)')
  expect(drawn.opacity).toBe('1')
})

test('out on the canvas, what the pane shows lies on its window under the camera, its strip cut away', () => {
  const camera = { x: 40, y: -20, zoom: 0.5 }
  const pose = { x: 200, y: 300, w: 320, h: 240, tab: 0, alpha: 1 }
  const drawn = paneDrawn(pose, camera, box, head, 10, 1)
  const screen = { x: 40 + 200 * 0.5, y: -20 + 300 * 0.5, w: 160, h: 120 }
  const corner = drawnAt(drawn.transform, box, 0, head)
  expect(corner.x).toBeCloseTo(screen.x)
  expect(corner.y).toBeCloseTo(screen.y)
  expect(drawnAt(drawn.transform, box, box.width, head).x).toBeCloseTo(screen.x + screen.w)
  const [top, bottom, radius] = (
    /inset\(([\d.]+)px 0 ([\d.]+)px 0 round ([\d.]+)px\)/.exec(drawn.clipPath) ?? []
  )
    .slice(1)
    .map(Number)
  expect(top).toBe(head)
  const scale = screen.w / box.width
  expect(head + (box.height - head - (bottom ?? 0))).toBeCloseTo(head + screen.h / scale)
  expect((radius ?? 0) * scale).toBeCloseTo(10)
})
