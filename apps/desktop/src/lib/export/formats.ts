import { key } from '../i18n.svelte'

/** Every format a note goes out as, in one fixed order.
 *
 *  The order is the list's, not the caller's: the File menu, the palette and the
 *  shortcut settings all read it from here, so a row sits in the same place
 *  wherever a person looks for it. Plain text first because it is the plainest,
 *  then the two that are still markdown, then the documents, then the pictures,
 *  then the three a word processor and a reader open.
 *
 *  Data only, and nothing imported but the marker for a string that wants
 *  translating: the palette builds this list at startup, and the exporter itself
 *  carries fonts, a zip and a Word writer that a list of names has no use for. */
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

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id']

/** The variants: the same format with one thing done differently. Each is a row
 *  of its own rather than a checkbox, because the choice is made once, at the
 *  moment of exporting, and a dialog to make it in would be a dialog in the way
 *  of every export that does not need one. */
export const EXPORT_VARIANTS = [
  { id: 'md-assets', label: key('Markdown with the pictures'), extension: 'md' },
  { id: 'html-bare', label: key('HTML without styles'), extension: 'html' },
] as const

export type ExportVariant = (typeof EXPORT_VARIANTS)[number]['id']

/** Anything the export list can be asked for. */
export type Exportable = ExportFormat | ExportVariant

const EXTENSIONS = new Map<string, string>(
  [...EXPORT_FORMATS, ...EXPORT_VARIANTS].map((entry) => [entry.id, entry.extension]),
)

/** The extension the file gets, or `bin` for an id from a later build - which
 *  cannot happen from inside this one and is still not worth a throw. */
export function extensionFor(id: Exportable): string {
  return EXTENSIONS.get(id) ?? 'bin'
}

/** A TextBundle is a folder, and a browser cannot be handed one. There it goes
 *  out zipped instead, which is what `.textpack` is for; see textbundle.org. */
export const TEXTPACK = 'textpack'
