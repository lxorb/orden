import { key } from '../i18n.svelte'

export const EXPORT_FORMATS = [
  { id: 'txt', label: key('Plain text'), extension: 'txt' },
  { id: 'md', label: 'Markdown', extension: 'md' },
  { id: 'textbundle', label: 'TextBundle', extension: 'textbundle' },
  { id: 'rtf', label: 'RTF', extension: 'rtf' },
  { id: 'pdf', label: 'PDF', extension: 'pdf' },
  { id: 'jpg', label: 'JPG', extension: 'jpg' },
  { id: 'png', label: 'PNG', extension: 'png' },
  { id: 'html', label: 'HTML', extension: 'html' },
  { id: 'docx', label: 'Word', extension: 'docx' },
  { id: 'epub', label: 'ePub', extension: 'epub' },
] as const

type ExportFormat = (typeof EXPORT_FORMATS)[number]['id']

export const EXPORT_VARIANTS = [
  { id: 'md-assets', label: key('Markdown with the pictures'), extension: 'md' },
  { id: 'html-bare', label: key('HTML without styles'), extension: 'html' },
] as const

type ExportVariant = (typeof EXPORT_VARIANTS)[number]['id']

export type Exportable = ExportFormat | ExportVariant

const EXTENSIONS = new Map<string, string>(
  [...EXPORT_FORMATS, ...EXPORT_VARIANTS].map((entry) => [entry.id, entry.extension]),
)

export function extensionFor(id: Exportable): string {
  return EXTENSIONS.get(id) ?? 'bin'
}

export const TEXTPACK = 'textpack'
