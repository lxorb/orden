import type { Extension } from '@codemirror/state'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { imageExtension } from './image'
import { pointerSnap } from './snap'

/** Hides markdown syntax until the caret enters the construct that owns it.
 *  The document text is never rewritten - only what you see changes. */
export function livePreview(): Extension {
  return [dragFreeze, pointerSnap, livePreviewDecorations, blockDecorations, imageExtension]
}

export { blockDecorations, livePreviewDecorations }
