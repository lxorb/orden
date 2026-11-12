export const PANDOC_FORMATS = [
  { id: 'odt', label: 'OpenOffice', extension: 'odt' },
  { id: 'latex', label: 'LaTeX', extension: 'tex' },
  { id: 'mediawiki', label: 'MediaWiki', extension: 'wiki' },
  { id: 'rst', label: 'reStructuredText', extension: 'rst' },
  { id: 'textile', label: 'Textile', extension: 'textile' },
  { id: 'opml', label: 'OPML', extension: 'opml' },
  { id: 'revealjs', label: 'Presentation', extension: 'html' },
] as const

export type PandocFormat = (typeof PANDOC_FORMATS)[number]['id']
