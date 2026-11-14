import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.mjs'
import Brush from 'lucide/dist/esm/icons/brush.mjs'
import Circle from 'lucide/dist/esm/icons/circle.mjs'
import Copy from 'lucide/dist/esm/icons/copy.mjs'
import CornerDownRight from 'lucide/dist/esm/icons/corner-down-right.mjs'
import Diamond from 'lucide/dist/esm/icons/diamond.mjs'
import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
import Eraser from 'lucide/dist/esm/icons/eraser.mjs'
import Feather from 'lucide/dist/esm/icons/feather.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Frame from 'lucide/dist/esm/icons/frame.mjs'
import GripVertical from 'lucide/dist/esm/icons/grip-vertical.mjs'
import Group from 'lucide/dist/esm/icons/group.mjs'
import Hand from 'lucide/dist/esm/icons/hand.mjs'
import Highlighter from 'lucide/dist/esm/icons/highlighter.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import Lasso from 'lucide/dist/esm/icons/lasso.mjs'
import Link2 from 'lucide/dist/esm/icons/link-2.mjs'
import Minus from 'lucide/dist/esm/icons/minus.mjs'
import MousePointer2 from 'lucide/dist/esm/icons/mouse-pointer-2.mjs'
import Paintbrush from 'lucide/dist/esm/icons/paintbrush.mjs'
import PenLine from 'lucide/dist/esm/icons/pen-line.mjs'
import PenTool from 'lucide/dist/esm/icons/pen-tool.mjs'
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import Plus from 'lucide/dist/esm/icons/plus.mjs'
import Pointer from 'lucide/dist/esm/icons/pointer.mjs'
import Redo2 from 'lucide/dist/esm/icons/redo-2.mjs'
import Ruler from 'lucide/dist/esm/icons/ruler.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
import Slash from 'lucide/dist/esm/icons/slash.mjs'
import Square from 'lucide/dist/esm/icons/square.mjs'
import StickyNote from 'lucide/dist/esm/icons/sticky-note.mjs'
import Trash2 from 'lucide/dist/esm/icons/trash-2.mjs'
import Triangle from 'lucide/dist/esm/icons/triangle.mjs'
import Type from 'lucide/dist/esm/icons/type.mjs'
import Undo2 from 'lucide/dist/esm/icons/undo-2.mjs'
import Ungroup from 'lucide/dist/esm/icons/ungroup.mjs'
import type { IconNode } from 'lucide'

import { type InkTool } from '@orden/markdown/canvas'
import { type Tool } from './pointer'
import { shortcuts } from '../../shortcuts.svelte'

export interface Mark {
  icon: IconNode
  title: () => string
  key: string | null
}

export interface ToolMark extends Mark {
  id: Tool
}

export function hinted(mark: Pick<Mark, 'title' | 'key'>): string {
  return shortcuts.tooltip(mark.title(), mark.key)
}

export const ABOUT: ToolMark[] = [
  {
    id: 'select',
    icon: MousePointer2,
    title: () => 'Select',
    key: 'canvas.tool.select',
  },
  { id: 'hand', icon: Hand, title: () => 'Pan', key: 'canvas.tool.hand' },
]

export const WORDS: ToolMark = {
  id: 'words',
  icon: Type,
  title: () => 'Text',
  key: 'canvas.tool.words',
}

export const RUBBING: ToolMark[] = [
  { id: 'erase', icon: Eraser, title: () => 'Erase', key: 'canvas.tool.erase' },
  { id: 'lasso', icon: Lasso, title: () => 'Lasso', key: 'canvas.tool.lasso' },
]

export const PLACING: ToolMark[] = [
  { id: 'text', icon: StickyNote, title: () => 'Card', key: 'canvas.tool.text' },
  { id: 'file', icon: FileText, title: () => 'Note', key: 'canvas.tool.file' },
  { id: 'picture', icon: Image, title: () => 'Picture', key: 'canvas.tool.picture' },
  { id: 'link', icon: Link2, title: () => 'Link', key: 'canvas.tool.link' },
  { id: 'group', icon: Frame, title: () => 'Frame', key: 'canvas.tool.group' },
  { id: 'rect', icon: Square, title: () => 'Rectangle', key: 'canvas.tool.rect' },
  { id: 'ellipse', icon: Circle, title: () => 'Oval', key: 'canvas.tool.ellipse' },
  { id: 'rhombus', icon: Diamond, title: () => 'Diamond', key: 'canvas.tool.rhombus' },
  { id: 'triangle', icon: Triangle, title: () => 'Triangle', key: 'canvas.tool.triangle' },
  { id: 'line', icon: Slash, title: () => 'Line', key: 'canvas.tool.line' },
  { id: 'arrow', icon: ArrowUpRight, title: () => 'Arrow', key: 'canvas.tool.arrow' },
  { id: 'elbow', icon: CornerDownRight, title: () => 'Elbow', key: 'canvas.tool.elbow' },
]

export const PEN_ICONS: Record<InkTool, IconNode> = {
  pen: PenLine,
  fountain: PenTool,
  pencil: Pencil,
  marker: Paintbrush,
  highlighter: Highlighter,
  brush: Brush,
  calligraphy: Feather,
}

export const PEN_NAMES: Record<InkTool, () => string> = {
  pen: () => 'Pen',
  fountain: () => 'Fountain pen',
  pencil: () => 'Pencil',
  marker: () => 'Marker',
  highlighter: () => 'Highlighter',
  brush: () => 'Brush',
  calligraphy: () => 'Calligraphy',
}

export const MARKS = {
  undo: Undo2,
  redo: Redo2,
  zoomOut: Minus,
  zoomIn: Plus,
  put: Shapes,
  rest: Ellipsis,
  copy: Copy,
  bin: Trash2,
  group: Group,
  ungroup: Ungroup,
  grip: GripVertical,
  straight: Ruler,
  finger: Pointer,
} as const
