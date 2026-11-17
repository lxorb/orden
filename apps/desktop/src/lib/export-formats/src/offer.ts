import { type Exportable, EXPORT_FORMATS, EXPORT_VARIANTS } from './formats'

export type ExportKind = 'note' | 'canvas' | 'pages' | 'file' | 'none'

export const EXPORT_EXTRAS = [
  { id: 'svg', label: 'Export as SVG' },
  { id: 'copy', label: 'Save a copy' },
] as const

export type ExportId = Exportable | (typeof EXPORT_EXTRAS)[number]['id']

const FORMATS = EXPORT_FORMATS.map((format) => format.id)
const VARIANTS = EXPORT_VARIANTS.map((variant) => variant.id)

const OFFERS: Record<ExportKind, readonly ExportId[]> = {
  note: [...FORMATS, ...VARIANTS],
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
  exports: ExportKind
  path: string | null
}

export function exportKindOf(open: Open | null): ExportKind {
  if (!open) return 'none'
  return open.exports === 'file' && open.path === null ? 'none' : open.exports
}

export function isNoteFormat(id: ExportId): id is Exportable {
  return EXPORT_FORMATS.some((one) => one.id === id) || EXPORT_VARIANTS.some((one) => one.id === id)
}

export function labelOf(id: ExportId): string {
  const extra = EXPORT_EXTRAS.find((one) => one.id === id)
  if (extra) return extra.label

  const format = [...EXPORT_FORMATS, ...EXPORT_VARIANTS].find((one) => one.id === id)
  return format ? `Export as ${format.label}` : id
}

export const canPrint = typeof window !== 'undefined' && typeof window.print === 'function'

const PRINTABLE: ReadonlySet<string> = new Set(
  __EVEN_PLUGIN__ ? ['note'] : ['note', 'canvas', 'pages'],
)

export function printable(kind: string | undefined): boolean {
  return kind !== undefined && PRINTABLE.has(kind)
}
