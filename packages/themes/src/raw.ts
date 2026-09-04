import katex from 'katex/dist/katex.min.css?raw'
import base from './base.css?raw'
import exported from './export.css?raw'
import tokens from './tokens.css?raw'

/** The stylesheet as text, for baking into an exported document.
 *  Relative `?raw` imports resolve reliably; the same imports made through the
 *  package's exports map from another package come back empty. */
export const themeCss = [tokens, base].join('\n')

/** What an exported document needs on top of the theme: a page instead of an
 *  app around the text, and how it prints. */
export const exportCss = exported

/** KaTeX's own stylesheet. Its fonts are referenced by relative path, which
 *  an export resolves before writing the file. */
export const katexCss = katex
