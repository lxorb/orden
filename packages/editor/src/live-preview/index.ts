import type { Extension } from '@codemirror/state'
import { aiExtension } from '../ai/run'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { footnoteReading } from './footnotes'
import { hiddenFrontMatterGuard } from './hidden-front-matter'
import { imageExtension } from './image'
import { runExtension } from '../run/door'
import { propertiesOpen } from './properties'
import { pointerSnap } from './snap'

export function livePreview(): Extension {
  return [
    aiExtension,
    dragFreeze,
    footnoteReading,
    pointerSnap,
    livePreviewDecorations,
    blockDecorations,
    hiddenFrontMatterGuard,
    propertiesOpen,
    imageExtension,
    runExtension(),
  ]
}

export { blockDecorations }
