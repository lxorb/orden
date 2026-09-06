import { frontMatter } from '@nib/markdown'

/** Paper the print dialog understands, in `@page size` spelling. */
export const PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const

export const ORIENTATIONS = ['portrait', 'landscape'] as const

type Paper = (typeof PAPER_SIZES)[number]
type Orientation = (typeof ORIENTATIONS)[number]

/** The units a stylesheet and a printer both understand, and how many of each
 *  make an inch. One list, so a unit cannot be accepted when a length is read
 *  and then be unknown when it is converted. */
const PER_INCH = { mm: 25.4, cm: 2.54, in: 1, pt: 72, px: 96 } as const
type Unit = keyof typeof PER_INCH
const UNITS: readonly Unit[] = ['mm', 'cm', 'in', 'pt', 'px']
const LENGTH = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNITS.join('|')})?$`)

/** A length pulled apart. The amount stays as it was written, so `2.50` does
 *  not lose its trailing zero on the way through a number. */
interface Length {
  amount: string
  unit: Unit
}

const DEFAULT_MARGIN: Length = { amount: '20', unit: 'mm' }

function isUnit(value: string): value is Unit {
  return UNITS.some((unit) => unit === value)
}

/** Accepts `15mm`, `0.5in` or a bare number, and refuses anything else so the
 *  value can go straight into a stylesheet. A bare number is millimetres. */
function parseLength(value: string): Length | null {
  const [, amount, unit] = LENGTH.exec(value.trim()) ?? []
  if (amount === undefined) return null

  return { amount, unit: unit !== undefined && isUnit(unit) ? unit : DEFAULT_MARGIN.unit }
}

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
  margin: `${DEFAULT_MARGIN.amount}${DEFAULT_MARGIN.unit}`,
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

    const [, field, written = ''] = /^\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line) ?? []
    if (field === undefined) continue

    const value = written.trim().replace(/^["']|["']$/g, '')
    if (!value) continue

    switch (field.toLowerCase()) {
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

/** The same length written the way a stylesheet takes it, or null when what
 *  came in is not a length at all. */
export function length(value: string): string | null {
  const parsed = parseLength(value)
  return parsed ? `${parsed.amount}${parsed.unit}` : null
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

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

/** Wraps the page body so a header repeats at the top of every sheet and a
 *  footer sits at the bottom of each. Browsers repeat a table's head and foot
 *  across pages and reserve their room, which is what makes running text
 *  possible without a print engine; a plain export stays a plain document. */
export function withRunningText(
  body: string,
  setup: PageSetup,
  title: string,
  date: string,
): string {
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
  const margin = parseLength(setup.margin) ?? DEFAULT_MARGIN

  return {
    width,
    height,
    margin: Math.round((Number(margin.amount) / PER_INCH[margin.unit]) * 1000) / 1000,
    landscape: setup.orientation === 'landscape',
  }
}
