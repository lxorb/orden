import { type Canvas as Plane, canvasIn } from '@orden/markdown/canvas'

export {
  blankCanvas,
  type Canvas,
  type CanvasColour,
  canvasRuns,
  type CanvasEdge,
  type CanvasNode,
  clampOpacity,
  DEFAULT_HEIGHT,
  DEFAULT_INK,
  DEFAULT_WIDTH,
  emptyCanvas,
  freshId,
  type InkPoint,
  type InkStroke,
  type InkTool,
  INK_TOOLS,
  isInkTool,
  isShape,
  type PageNode,
  type Paper,
  PAPER_NAMES,
  type Pattern,
  PATTERNS,
  PRESET_COLOURS,
  printStrokes,
  readCanvas,
  type Shape,
  type Side,
  writeCanvas,
} from '@orden/markdown/canvas'

export { merged, stamped } from '@orden/markdown/canvas-merge'

let waiting: { text: string; canvas: Plane } | null = null

export function parseAhead(text: string): boolean {
  const canvas = canvasIn(text)
  waiting = canvas ? { text, canvas } : null
  return canvas !== null
}

export function takeParsed(text: string): Plane | null {
  const held = waiting?.text === text ? waiting.canvas : null
  if (held) waiting = null

  return held
}

export function forgetParsed(): void {
  waiting = null
}
