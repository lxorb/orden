import { type Turned, wheelPixels } from '../../camera/src/api'

export interface Point {
  x: number
  y: number
}

export interface Crop {
  zoom: number
  offset: Point
}

export const MOST_ZOOM = 4

export function scaleAt(width: number, height: number, view: number, zoom: number): number {
  return (zoom * view) / Math.min(width, height)
}

export function wheeledZoom(zoom: number, turn: Turned): number {
  return zoom * Math.exp(-wheelPixels(turn).y / 400)
}

export function clampZoom(zoom: number): number {
  return Math.min(MOST_ZOOM, Math.max(1, zoom))
}

export function clampOffset(
  offset: Point,
  width: number,
  height: number,
  view: number,
  zoom: number,
): Point {
  const scale = scaleAt(width, height, view, zoom)
  const spareX = Math.max(0, (width * scale - view) / 2)
  const spareY = Math.max(0, (height * scale - view) / 2)
  return {
    x: Math.min(spareX, Math.max(-spareX, offset.x)) + 0,
    y: Math.min(spareY, Math.max(-spareY, offset.y)) + 0,
  }
}

export function zoomed(
  crop: Crop,
  to: number,
  at: Point,
  width: number,
  height: number,
  view: number,
): Crop {
  const zoom = clampZoom(to)
  const ratio = zoom / crop.zoom
  const offset = {
    x: at.x - (at.x - crop.offset.x) * ratio,
    y: at.y - (at.y - crop.offset.y) * ratio,
  }
  return { zoom, offset: clampOffset(offset, width, height, view, zoom) }
}

export function sourceSquare(
  crop: Crop,
  width: number,
  height: number,
  view: number,
): { left: number; top: number; side: number } {
  const scale = scaleAt(width, height, view, crop.zoom)
  const side = view / scale
  const middleX = width / 2 - crop.offset.x / scale
  const middleY = height / 2 - crop.offset.y / scale
  return { left: middleX - side / 2, top: middleY - side / 2, side }
}

export function turned(width: number, height: number, turns: number): [number, number] {
  return turns % 2 === 0 ? [width, height] : [height, width]
}
