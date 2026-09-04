import { frontMatter } from '@nib/markdown'

/** Paper the print dialog understands, in `@page size` spelling. */
export const PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const

export const ORIENTATIONS = ['portrait', 'landscape'] as const

export type Paper = (typeof PAPER_SIZES)[number]
export type Orientation = (typeof ORIENTATIONS)[number]

export interface PageSetup {
  paper: Paper
  orientation: Orientation
  /** A CSS length, or a plain number read as millimetres. */
  margin: string
  header: string
  footer: string
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'portrait',
  margin: '20mm',
  header: '',
  footer: '',
}

/** A note can overrule the app's own settings through its front matter:
 *
 *      ---
 *      export:
 *        paper: Letter
 *        margin: 15mm
 *        footer: ${title}
 *      ---
 */
export function pageSetupFor(source: string, base: PageSetup = DEFAULT_PAGE_SETUP): PageSetup {
  const block = frontMatter(source)
  if (!block) return base

  const lines = block.split('\n')
  const start = lines.findIndex((line) => /^export\s*:\s*$/.test(line))
  if (start < 0) return base

  const setup = { ...base }

  for (const line of lines.slice(start + 1)) {
    // The block ends at the first line that is not indented under it.
    if (!/^\s+\S/.test(line)) break

    const pair = /^\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (!pair) continue

    const value = pair[2].trim().replace(/^["']|["']$/g, '')
    if (!value) continue

    switch (pair[1].toLowerCase()) {
      case 'paper':
      case 'size': {
        const paper = PAPER_SIZES.find((entry) => entry.toLowerCase() === value.toLowerCase())
        if (paper) setup.paper = paper
        break
      }
      case 'orientation':
        if (value === 'portrait' || value === 'landscape') setup.orientation = value
        break
      case 'margin':
        setup.margin = length(value) ?? setup.margin
        break
      case 'header':
        setup.header = value
        break
      case 'footer':
        setup.footer = value
        break
    }
  }

  return setup
}

/** Accepts `15mm`, `0.5in` or a bare number, and refuses anything else so the
 *  value can go straight into a stylesheet. */
export function length(value: string): string | null {
  const match = /^(\d+(?:\.\d+)?)\s*(mm|cm|in|pt|px)?$/.exec(value.trim())
  return match ? `${match[1]}${match[2] ?? 'mm'}` : null
}

/** `${title}` and `${date}` are the only placeholders; page numbers come from
 *  the print dialog, which is the only thing that knows how many there are. */
export function fill(template: string, title: string, date: string): string {
  return template
    .replace(/\$\{title\}/g, title)
    .replace(/\$\{date\}/g, date)
    .replace(/\$\{year\}/g, date.slice(0, 4))
}

/** The paper half of the print stylesheet. */
export function pageCss(setup: PageSetup): string {
  const margin = length(setup.margin) ?? DEFAULT_PAGE_SETUP.margin
  return `@page { size: ${setup.paper} ${setup.orientation}; margin: ${margin}; }`
}

function escape(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
  )
}

/** Wraps the page body so a header repeats at the top of every sheet and a
 *  footer sits at the bottom of each. Browsers repeat a table's head and foot
 *  across pages and reserve their room, which is what makes running text
 *  possible without a print engine; a plain export stays a plain document. */
export function withRunningText(body: string, setup: PageSetup, title: string, date: string): string {
  if (!setup.header && !setup.footer) return body

  const header = setup.header
    ? `<thead><tr><td><div class="running-header">${escape(fill(setup.header, title, date))}</div></td></tr></thead>\n`
    : ''
  const footer = setup.footer
    ? `<tfoot><tr><td></td></tr></tfoot>\n<div class="running-footer">${escape(fill(setup.footer, title, date))}</div>\n`
    : ''

  return `<table class="sheet">\n${header}<tbody><tr><td>\n${body}</td></tr></tbody>\n</table>\n${footer}`
}

/** Paper in inches, the unit a native print engine takes. */
const PAPER_INCHES: Record<Paper, [number, number]> = {
  A3: [11.69, 16.54],
  A4: [8.27, 11.69],
  A5: [5.83, 8.27],
  Letter: [8.5, 11],
  Legal: [8.5, 14],
}

const PER_INCH: Record<string, number> = { mm: 25.4, cm: 2.54, in: 1, pt: 72, px: 96 }

export interface PaperInches {
  width: number
  height: number
  margin: number
  landscape: boolean
}

/** The same setup as numbers, for the native printer on the desktop. The
 *  sheet is given upright; the printer turns it when the page is landscape. */
export function paperInches(setup: PageSetup): PaperInches {
  const [width, height] = PAPER_INCHES[setup.paper]
  const margin = length(setup.margin) ?? DEFAULT_PAGE_SETUP.margin
  const [, amount, unit] = /^(\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/.exec(margin)!

  return {
    width,
    height,
    margin: Math.round((Number(amount) / PER_INCH[unit]) * 1000) / 1000,
    landscape: setup.orientation === 'landscape',
  }
}
