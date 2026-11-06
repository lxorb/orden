import { isDeck } from '@orden/markdown/slide-breaks'
import { key, t } from '../i18n.svelte'
import { type TabKind, TAB_KINDS } from '../workspace/tab-kinds'
import { type Exportable, EXPORT_FORMATS, EXPORT_VARIANTS } from './formats'

export type ExportKind = 'note' | 'deck' | 'canvas' | 'pages' | 'file' | 'none'

export const EXPORT_EXTRAS = [
  { id: 'svg', label: key('Export as SVG') },
  { id: 'slides-html', label: key('Export slides as HTML') },
  { id: 'slides-pdf', label: key('Export slides as PDF') },
  { id: 'copy', label: key('Save a copy') },
] as const

export type ExportId = Exportable | (typeof EXPORT_EXTRAS)[number]['id']

const FORMATS = EXPORT_FORMATS.map((format) => format.id)
const VARIANTS = EXPORT_VARIANTS.map((variant) => variant.id)

const OFFERS: Record<ExportKind, readonly ExportId[]> = {
  note: [...FORMATS, ...VARIANTS],
  deck: [...FORMATS, 'slides-html', 'slides-pdf', ...VARIANTS],
  canvas: ['png', 'svg', 'pdf'],
  pages: ['pdf', 'png', 'svg'],
  file: ['copy'],
  none: [],
}

export function offeredBy(kind: ExportKind): readonly ExportId[] {
  return OFFERS[kind]
}

export const EXPORT_KEYS: readonly ExportId[] = [
  ...FORMATS,
  ...EXPORT_EXTRAS.map((extra) => extra.id),
]

export interface Open {
  kind: TabKind
  path: string | null
  text: string
}

export function exportKindOf(open: Open | null): ExportKind {
  if (!open) return 'none'

  switch (TAB_KINDS[open.kind].exports) {
    case 'note':
      return isDeck(open.text) ? 'deck' : 'note'

    case 'canvas':
      return 'canvas'

    case 'pages':
      return 'pages'

    case 'file':
      return open.path === null ? 'none' : 'file'

    case 'none':
      return 'none'
  }
}

export function isNoteFormat(id: ExportId): id is Exportable {
  return EXPORT_FORMATS.some((one) => one.id === id) || EXPORT_VARIANTS.some((one) => one.id === id)
}

export function labelOf(id: ExportId): string {
  const extra = EXPORT_EXTRAS.find((one) => one.id === id)
  if (extra) return t(extra.label)

  const format = [...EXPORT_FORMATS, ...EXPORT_VARIANTS].find((one) => one.id === id)
  return format ? t('Export as {format}', { format: t(format.label) }) : id
}
