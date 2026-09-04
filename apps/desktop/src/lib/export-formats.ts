import { key } from './i18n.svelte'

/** Formats pandoc can produce, in the order Typora lists them. The labels
 *  are product names and stay as they are; only `Presentation` is a plain
 *  noun, and it is translated where it is shown.
 *
 *  Kept apart from the exporter itself, which carries fonts and parsers the
 *  command list has no use for: this is all the palette needs at startup. */
export const PANDOC_FORMATS = [
  { id: 'docx', label: 'Word', extension: 'docx' },
  { id: 'odt', label: 'OpenOffice', extension: 'odt' },
  { id: 'rtf', label: 'RTF', extension: 'rtf' },
  { id: 'epub', label: 'ePub', extension: 'epub' },
  { id: 'latex', label: 'LaTeX', extension: 'tex' },
  { id: 'mediawiki', label: 'MediaWiki', extension: 'wiki' },
  { id: 'rst', label: 'reStructuredText', extension: 'rst' },
  { id: 'textile', label: 'Textile', extension: 'textile' },
  { id: 'opml', label: 'OPML', extension: 'opml' },
  { id: 'revealjs', label: key('Presentation'), extension: 'html' },
] as const

export type PandocFormat = (typeof PANDOC_FORMATS)[number]['id']
