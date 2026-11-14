import type { PaperInches } from './files-out/src/api'
import { escapeAll } from '@orden/markdown/html'
import { frontMatter, frontMatterValue } from '@orden/markdown'
import { DEFAULT_PAGE_SETUP, type PageSetup, type Paper, PAPER_SIZES } from './paper'

const PER_INCH = { mm: 25.4, cm: 2.54, in: 1, pt: 72, px: 96 } as const
type Unit = keyof typeof PER_INCH
const UNITS: readonly Unit[] = ['mm', 'cm', 'in', 'pt', 'px']
const LENGTH = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNITS.join('|')})?$`)

interface Length {
  amount: string
  unit: Unit
}

const DEFAULT_MARGIN: Length = { amount: '20', unit: 'mm' }

function isUnit(value: string): value is Unit {
  return UNITS.some((unit) => unit === value)
}

function parseLength(value: string): Length | null {
  const [, amount, unit] = LENGTH.exec(value.trim()) ?? []
  if (amount === undefined) return null

  return { amount, unit: unit !== undefined && isUnit(unit) ? unit : DEFAULT_MARGIN.unit }
}

export function pageSetupFor(source: string, base: PageSetup = DEFAULT_PAGE_SETUP): PageSetup {
  const block = frontMatter(source)
  if (!block) return base

  const lines = block.split(/\r?\n/)
  const start = lines.findIndex((line) => /^export\s*:\s*$/.test(line))
  if (start < 0) return base

  const setup = { ...base }

  for (const line of lines.slice(start + 1)) {
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

export function length(value: string): string | null {
  const parsed = parseLength(value)
  return parsed ? `${parsed.amount}${parsed.unit}` : null
}

export function fill(template: string, title: string, date: string): string {
  return template
    .replace(/\$\{title\}/g, () => title)
    .replace(/\$\{date\}/g, () => date)
    .replace(/\$\{year\}/g, () => date.slice(0, 4))
}

export function pageCss(setup: PageSetup): string {
  const margin = length(setup.margin) ?? DEFAULT_PAGE_SETUP.margin
  return `@page { size: ${setup.paper} ${setup.orientation}; margin: ${margin}; }`
}

export function withRunningText(
  body: string,
  setup: PageSetup,
  title: string,
  date: string,
): string {
  if (!setup.header && !setup.footer) return body

  const header = setup.header
    ? `<thead><tr><td><div class="running-header">${escapeAll(fill(setup.header, title, date))}</div></td></tr></thead>\n`
    : ''
  const footer = setup.footer
    ? `<tfoot><tr><td></td></tr></tfoot>\n<div class="running-footer">${escapeAll(fill(setup.footer, title, date))}</div>\n`
    : ''

  return `<table class="sheet">\n${header}<tbody><tr><td>\n${body}</td></tr></tbody>\n</table>\n${footer}`
}

export const TWIPS_PER_INCH = 1440

const PAPER_INCHES: Record<Paper, [number, number]> = {
  A3: [297 / PER_INCH.mm, 420 / PER_INCH.mm],
  A4: [210 / PER_INCH.mm, 297 / PER_INCH.mm],
  A5: [148 / PER_INCH.mm, 210 / PER_INCH.mm],
  Letter: [8.5, 11],
  Legal: [8.5, 14],
}

function localDay(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

export function runningDate(source: string, given?: string, now = new Date()): string {
  return given ?? frontMatterValue(source, 'date') ?? localDay(now)
}

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

export interface PaperTwips {
  width: number
  height: number
  margin: number
  landscape: boolean
  header: string
  footer: string
}

export function paperTwips(setup: PageSetup, title: string, date: string): PaperTwips {
  const [width, height] = PAPER_INCHES[setup.paper]
  const margin = parseLength(setup.margin) ?? DEFAULT_MARGIN
  const twips = (value: number) => Math.round(value * TWIPS_PER_INCH)

  return {
    width: twips(width),
    height: twips(height),
    margin: twips(Number(margin.amount) / PER_INCH[margin.unit]),
    landscape: setup.orientation === 'landscape',
    header: setup.header ? fill(setup.header, title, date) : '',
    footer: setup.footer ? fill(setup.footer, title, date) : '',
  }
}
