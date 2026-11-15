import type { Extension } from '@codemirror/state'
import { aiExtension } from '../ai/run'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { footnoteReading } from './footnotes'
import { imageExtension } from './image'
import { runExtension } from '../run/door'
import { dropSpacing, pointerSnap } from './snap'
import { tableWrites } from '../table/navigation'
import { tableTracking } from '../table/widget'

export function livePreview(): Extension {
  return [
    aiExtension,
    dragFreeze,
    footnoteReading,
    pointerSnap,
    dropSpacing,
    livePreviewDecorations,
    blockDecorations,
    tableTracking,
    tableWrites,
    imageExtension,
    runExtension(),
  ]
}

export { blockDecorations }
