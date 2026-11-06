import { Marked, type Token, type Tokens } from 'marked'
import { blockMath, definitionList, noSetextHeadings } from './blocks'
import { BLANK, bodyStart, fenceChange, HORIZONTAL, lines, VERTICAL } from './slide-breaks'

export type SlideShape = 'title' | 'picture' | 'prose'

export interface Slide {
  from: number
  to: number
  markdown: string
  notes: string
  vertical: boolean
  fragments: number[]
  shape: SlideShape
}

const NOTES = /^notes?:[ \t]*/i
const HEADING = /^#{1,6}[ \t]/
const PICTURE = /^!\[[^\]]*\]\([^)]*\)$|^!\[\[[^\]]+\]\]$/

interface Break {
  from: number
  to: number
  vertical: boolean
}

function breaks(source: string, start: number): Break[] {
  const found: Break[] = []
  let fence: string | null = null
  let blank = true

  for (const line of lines(source, start)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      blank = false
      continue
    }

    if (fence) {
      blank = false
      continue
    }

    if (blank && (HORIZONTAL.test(line.text) || VERTICAL.test(line.text))) {
      found.push({ from: line.from, to: line.to, vertical: VERTICAL.test(line.text) })
      blank = false
      continue
    }

    blank = BLANK.test(line.text)
  }

  return found
}

function split(markdown: string): { shown: string; notes: string } {
  let fence: string | null = null
  let blank = true

  for (const line of lines(markdown, 0)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      blank = false
      continue
    }

    if (!fence && blank && NOTES.test(line.text)) {
      return {
        shown: markdown.slice(0, line.from).trimEnd(),
        notes: markdown.slice(line.from).replace(NOTES, '').trim(),
      }
    }

    blank = !fence && BLANK.test(line.text)
  }

  return { shown: markdown, notes: '' }
}

function onlyHeadings(markdown: string): boolean {
  const rows = markdown.split('\n').filter((row) => !BLANK.test(row))
  return rows.length > 0 && rows.every((row) => HEADING.test(row))
}

function shapeOf(markdown: string): SlideShape {
  const body = markdown.trim()
  if (PICTURE.test(body)) return 'picture'
  return onlyHeadings(body) ? 'title' : 'prose'
}

const blocks = new Marked({ gfm: true, breaks: false })
blocks.use(noSetextHeadings, { extensions: [blockMath, definitionList] })

function listItems(markdown: string): Tokens.ListItem[] {
  const found: Tokens.ListItem[] = []

  const walk = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) {
          found.push(item)
          walk(item.tokens)
        }
        continue
      }

      const inside = (token as { tokens?: Token[] }).tokens
      if (inside) walk(inside)
    }
  }

  walk(blocks.lexer(markdown))
  return found
}

function fragmentsOf(markdown: string): number[] {
  if (!markdown.includes('+')) return []

  return listItems(markdown).flatMap((item, at) => (/^[ \t]*\+/.test(item.raw) ? [at] : []))
}

export function deckOf(source: string): Slide[] {
  const start = bodyStart(source)
  const found = breaks(source, start)

  const slides: Slide[] = []
  let from = start
  let vertical = false

  const take = (to: number, next: boolean) => {
    const raw = source.slice(from, to)
    const { shown, notes } = split(raw)
    const markdown = shown.trim()

    if (markdown || notes) {
      slides.push({
        from,
        to,
        markdown,
        notes,
        vertical: vertical && slides.length > 0,
        fragments: fragmentsOf(markdown),
        shape: shapeOf(markdown),
      })
    }

    vertical = next
  }

  for (const one of found) {
    take(one.from, one.vertical)
    from = Math.min(one.to + 1, source.length)
  }
  take(source.length, false)

  return slides
}

export function slideAt(slides: readonly Slide[], at: number): number {
  let found = 0
  for (const [index, slide] of slides.entries()) if (slide.from <= at) found = index

  return found
}
