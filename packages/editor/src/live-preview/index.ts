import type { Extension } from '@codemirror/state'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { imageExtension } from './image'
import { runExtension } from '../run/run'
import { pointerSnap } from './snap'

/** Hides markdown syntax until the caret enters the construct that owns it.
 *  The document text is never rewritten - only what you see changes. */
export function livePreview(): Extension {
  // The run panels live here too, so switching to source mode takes them away
  // with everything else that is rendered rather than written.
  return [
    dragFreeze,
    pointerSnap,
    livePreviewDecorations,
    blockDecorations,
    imageExtension,
    runExtension,
  ]
}

export { blockDecorations, livePreviewDecorations }
