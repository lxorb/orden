/** The canvas file, as the app sees it.
 *
 *  The format itself lives in `@nib/markdown/canvas`, next to the wikilink
 *  grammar and for the same reason: three parts of Nib read it, and one of them
 *  is a worker that has no app around it. This file is what the surface imports,
 *  so nothing in the app has to know where the format went, and it is where the
 *  handful of things only a surface needs are kept. */

export {
  blankCanvas,
  type Canvas,
  type CanvasColour,
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
  PRESET_COLOURS,
  readCanvas,
  type Shape,
  type Side,
  writeCanvas,
} from '@nib/markdown/canvas'

export { merged, stamped } from '@nib/markdown/canvas-merge'
