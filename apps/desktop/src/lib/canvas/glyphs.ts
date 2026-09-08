/** The shapes the canvas bars are drawn from.
 *
 *  Two bars offer the same tools - the compact row a mouse gets and the pen bar a
 *  finger gets - and a glyph drawn twice is a glyph that drifts. So the paths, the
 *  ids and the words a screen reader says live here, once, and each bar decides
 *  only how big to draw them and in what order.
 *
 *  Every path is drawn in a 14 by 14 box, stroked rather than filled, so one set
 *  of `<svg>` attributes suits all of them. */

import { type InkTool } from './format'
import { type Tool } from './pointer'
import { t } from '../i18n.svelte'

export interface Glyph {
  id: Tool
  title: string
  path: string
}

/** What a press on the plane means. The arrow, the hand, and the three a pen
 *  wants. */
export const HOLDING: Glyph[] = [
  {
    id: 'select',
    title: t('Select'),
    path: 'M3.4 2.2 11 6.4l-3.3.9L9 11l-1.5.6-1.3-3.7-2.4 2.2z',
  },
  {
    id: 'hand',
    title: t('Pan'),
    path: 'M4 7.5V4.4a.9.9 0 0 1 1.8 0V7m0 0V3.4a.9.9 0 0 1 1.8 0V7m0 0V4.2a.9.9 0 0 1 1.8 0v4.4A3.4 3.4 0 0 1 6 12a3 3 0 0 1-2-2.8z',
  },
  {
    id: 'draw',
    title: t('Draw'),
    path: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5zM8.3 3.8l1.9 1.9',
  },
  {
    id: 'erase',
    title: t('Erase'),
    path: 'M4 11.4h7.4M2.8 8.6l4.3-4.3a1.3 1.3 0 0 1 1.9 0l1.7 1.7a1.3 1.3 0 0 1 0 1.9l-3.4 3.5H5.2z',
  },
  {
    id: 'lasso',
    title: t('Lasso'),
    path: 'M7 2.6c2.7 0 4.9 1.6 4.9 3.5S9.7 9.6 7 9.6 2.1 8 2.1 6.1 4.3 2.6 7 2.6M5.6 9.5c0 1.3.4 2 1.3 2',
  },
]

/** What a press puts on the plane. */
export const PLACING: Glyph[] = [
  { id: 'text', title: t('Card'), path: 'M2 3h10v8H2zM4.5 6h5M4.5 8h3' },
  { id: 'file', title: t('Note or picture'), path: 'M3.5 2h4l3 3v7h-7zM7.5 2v3h3' },
  {
    id: 'link',
    title: t('Link'),
    path: 'M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6',
  },
  { id: 'group', title: t('Group'), path: 'M2 4h10v8H2zM2 4V2h4v2' },
  { id: 'rect', title: t('Rectangle'), path: 'M2.5 3.5h9v7h-9z' },
  { id: 'ellipse', title: t('Ellipse'), path: 'M11.5 7a4.5 3.6 0 1 1-9 0 4.5 3.6 0 1 1 9 0' },
  { id: 'line', title: t('Line'), path: 'M2.6 11.4 11.4 2.6' },
  { id: 'arrow', title: t('Arrow'), path: 'M2.6 11.4 11.4 2.6M11.4 2.6H7.8M11.4 2.6v3.6' },
]

/** What each pen is called, in words, since a glyph of a nib and a glyph of a
 *  broad nib are two pictures of the same thing. Read out, or shown on a hover,
 *  beside a drawing of the pen itself. */
export const PEN_NAMES: Record<InkTool, string> = {
  pen: t('Pen'),
  fountain: t('Fountain pen'),
  pencil: t('Pencil'),
  marker: t('Marker'),
  highlighter: t('Highlighter'),
  brush: t('Brush'),
  calligraphy: t('Calligraphy'),
}

/** A glyph each for the seven pens, for the compact bar a mouse gets: a nib, a
 *  broad nib, a grainy one, a felt tip, a wide flat one, a brush and a chisel.
 *  The pen bar draws the pens themselves instead; see `nibs.ts`. */
export const NIBS: Record<InkTool, string> = {
  pen: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5z',
  fountain: 'M3 11.4 4.6 7 9.4 2.2l2.4 2.4L7 9.4zM4.6 7l2.4 2.4',
  pencil: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5zM4.6 8.2l1.2 1.2M6.2 6.6l1.2 1.2M7.8 5l1.2 1.2',
  marker: 'M3.4 11.4h7.2M4.4 8.8 8.2 5l2.2 2.2-3.8 3.8H4.4z',
  highlighter: 'M2.6 11.4h8.8M3.8 8.6 8.6 3.8l2.4 2.4-4.8 4.8H3.8z',
  brush: 'M3.6 10.6c1.8.8 3.4 0 3.8-1.8M5.2 8.4 10 3.6l1.2 1.2-4.8 4.8z',
  calligraphy: 'M2.6 10.6 9.8 3M4.2 11.8 11.4 4.2',
}

/** A fingertip, for the switch that says whether a finger draws on a device that
 *  has a pen. Only ever offered where the question exists. */
export const FINGER =
  'M4.6 11.4V8.2a2.4 2.4 0 0 1 4.8 0v3.2M7 8V4.2a1.2 1.2 0 0 1 2.4 0V8M4.6 8.6 3.4 7'

/** The rest of what the pen bar draws: the two arrows, the eraser's two ways of
 *  working, and the marks that add a pen, take one away and open the rest. */
export const MARKS = {
  undo: 'M4.6 4.2 2.2 6.6l2.4 2.4M2.2 6.6h5.6a3.6 3.6 0 0 1 0 7.2',
  redo: 'M9.4 4.2 11.8 6.6 9.4 9M11.8 6.6H6.2a3.6 3.6 0 0 0 0 7.2',
  /** A stroke gone whole: a written line, struck right through. */
  whole: 'M2 10.2c2-3.4 3.9-5.1 4.9-5.1 1 0 3 1.7 5.1 5.1M3.6 11.8 10.4 3.2',
  /** A hole rubbed in what is under it: the same line with a piece missing, and
   *  the eraser's round nib sitting in the gap it took. */
  area: 'M1.8 10.6 4.5 6.5M12.2 10.6 9.5 6.5M9.7 8.9a2.7 2.7 0 1 1-5.4 0 2.7 2.7 0 1 1 5.4 0',
  plus: 'M7 3.4v7.2M3.4 7h7.2',
  less: 'M3.4 7h7.2',
  more: 'M3 7h.1M7 7h.1M11 7h.1',
} as const
