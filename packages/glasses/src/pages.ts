import { fit, fold, rightward, SPACE, width, wrap } from './firmware'
import { hashOf } from './hash'
import type { Compaction, Marks } from './mark'
import { hangOf, type Line, markLines } from './mark'

export interface Paging {
  breakAt: number
  gutter: number
  inner: number
  rows: number
  marks?: Marks
  compaction?: Compaction
  rootIndent?: boolean
}

export interface Page {
  index: number
  from: number
  to: number
  hash: string
  words: string
  numbers: string
  section: string
  rule: string
  firstLine: number
  lastLine: number
}

const HEAVY = '═'
const LIGHT = '─'

interface Wrapped {
  line: Line
  rows: readonly string[]
  continues?: boolean
}

interface Taking {
  taken: Wrapped[]
  rows: number
  section: string
  rule: string
  head: Line | null
  next: { section: string; rule: string } | null
}

function empty(section: string, rule: string, head: Line | null = null): Taking {
  return { taken: [], rows: 0, section, rule, head, next: null }
}

function partsOf(whole: Wrapped, most: number, next: number): Wrapped[] {
  if (whole.rows.length <= most) return [whole]

  const span = Math.max(0, next - whole.line.from)
  const parts: Wrapped[] = []
  for (let at = 0; at < whole.rows.length; at += most) {
    const rows = whole.rows.slice(at, at + most)
    if (at === 0) {
      parts.push({ line: whole.line, rows })
      continue
    }

    const from = whole.line.from + Math.floor((span * at) / whole.rows.length)
    parts.push({ line: { ...whole.line, from, glued: false }, rows, continues: true })
  }
  return parts
}

export interface Work {
  pages: number
  lines: number
}

function nothing(): Work {
  return { pages: 0, lines: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

export function pagesOf(source: string, paging: Paging): Page[] {
  const marked = markLines(source, {
    inner: paging.inner,
    ...(paging.marks ? { marks: paging.marks } : {}),
    ...(paging.compaction ? { compaction: paging.compaction } : {}),
    ...(paging.rootIndent === undefined ? {} : { rootIndent: paging.rootIndent }),
  })
  if (!marked.length) return []

  const indent = ' '.repeat(paging.gutter > 0 ? Math.ceil(paging.gutter / SPACE) : 0)
  const inner = paging.inner - width(indent) - (indent === '' ? 0 : SPACE)
  const pages: Page[] = []
  let taking = empty('', LIGHT)

  const cut = (to: number) => {
    if (!taking.taken.length && !taking.head) return

    const first = (taking.next ? taking.head : taking.taken[0]?.line) ?? taking.head
    const shown: string[] = []
    const counted: string[] = []
    for (const { line, rows, continues } of taking.taken) {
      for (const [at, row] of rows.entries()) {
        shown.push(indent + row)
        if (indent !== '') {
          const room = paging.gutter - SPACE * 2
          counted.push(at === 0 && !continues ? rightward(fit(String(line.at), room), room) : '')
        }
      }
    }

    const words = shown.join('\n')
    const numbers = counted.join('\n')
    work.pages += 1
    pages.push({
      index: pages.length,
      from: first?.from ?? 0,
      to,
      hash: hashOf(`${taking.section}|${taking.rule}|${numbers}|${words}`),
      words,
      numbers,
      section: taking.section,
      rule: taking.rule,
      firstLine: first?.at ?? 1,
      lastLine: taking.taken.at(-1)?.line.at ?? first?.at ?? 1,
    })
  }

  const runFor = ({ line: coming, rows }: Wrapped): Wrapped[] => {
    if (!coming.glued) return []

    let back = 0
    while (back < taking.taken.length && taking.taken.at(-1 - back)?.line.glued === true) back++
    if (back + 1 >= taking.taken.length) return []

    const run = taking.taken.slice(-(back + 1))
    const held = run.reduce((sum, one) => sum + one.rows.length, 0)
    if (held + rows.length > paging.rows) return []

    return taking.taken.splice(-(back + 1))
  }

  for (const [at, line] of marked.entries()) {
    work.lines += 1
    if (paging.breakAt > 0 && line.level > 0 && line.level <= paging.breakAt) {
      const section = fold(line.text)
      const rule = line.level === 1 ? HEAVY : LIGHT
      if (taking.head && taking.taken.every((one) => one.line.level > 0 || one.line.under)) {
        taking.next = { section, rule }
      } else {
        cut(line.from)
        taking = empty(section, rule, section === '' ? null : line)
        continue
      }
    }

    if (taking.taken.length === 0 && taking.section !== '' && line.under) continue

    const whole = { line, rows: wrap(line.text, inner, hangOf(line.text)) }
    const next = marked[at + 1]?.from ?? source.length
    for (const part of partsOf(whole, paging.rows, next)) {
      if (taking.rows > 0 && taking.rows + part.rows.length > paging.rows) {
        const moving = runFor(part)
        for (const one of moving) taking.rows -= one.rows.length

        cut(moving[0]?.line.from ?? part.line.from)
        taking = empty(taking.next?.section ?? taking.section, taking.next?.rule ?? taking.rule)
        for (const one of moving) {
          taking.taken.push(one)
          taking.rows += one.rows.length
        }
      }

      taking.taken.push(part)
      taking.rows += part.rows.length
    }
  }

  cut(source.length)
  return pages
}

export function pageAt(pages: readonly Page[], offset: number): number {
  for (const page of pages) {
    if (offset < page.to) return page.index
  }

  return Math.max(0, pages.length - 1)
}

export function pageOfLine(pages: readonly Page[], line: number): number {
  for (const page of pages) {
    if (line <= page.lastLine) return page.index
  }

  return Math.max(0, pages.length - 1)
}
