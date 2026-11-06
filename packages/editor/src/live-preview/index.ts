import type { Extension } from '@codemirror/state'
import { aiExtension } from '../ai/run'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { footnoteReading } from './footnotes'
import { imageExtension } from './image'
import { runExtension } from '../run/door'
import { pointerSnap } from './snap'

export function livePreview(): Extension {
  return [
    aiExtension,
    dragFreeze,
    footnoteReading,
    pointerSnap,
    livePreviewDecorations,
    blockDecorations,
    imageExtension,
    runExtension(),
  ]
}

export { blockDecorations }
