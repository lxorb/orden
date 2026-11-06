import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import {
  type FrontMatterBlock,
  frontMatterBlock,
  valueClosesAt,
} from '@orden/markdown/front-matter'
import { codeSpans, inCode, TAG_NAME, tagAt } from '@orden/markdown/tags'

export interface TagUse {
  tag: string
  from: number
  to: number
}

const NAME = new RegExp(`^${TAG_NAME}$`, 'u')

const HASH = /#/g

const KEY = /^tags?:(.*)$/i

const ITEM = /^\s*-\s*(.*?)\s*$/

const VALUE = /[^\s,[\]'"]+/g

export function tagUses(body: string): TagUse[] {
  const out: TagUse[] = []
  const front = frontMatterBlock(body)

  if (front) readFront(body, front, out)
  readInline(body, front, out)

  return out
}

export function tagsIn(body: string): string[] {
  return tagUses(body).map((use) => `#${use.tag}`)
}

export function tagSpans(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  return tagUses(body)
    .filter((use) => {
      const folded = use.tag.toLowerCase()
      return folded === wanted || folded.startsWith(`${wanted}/`)
    })
    .map((use) => ({ from: use.from, to: use.from + wanted.length }))
}

export function tagCuts(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  const out: { from: number; to: number }[] = []

  for (const use of tagUses(body)) {
    const folded = use.tag.toLowerCase()
    if (folded !== wanted && !folded.startsWith(`${wanted}/`)) continue

    out.push(widened(body, use))
  }

  return out
}

function widened(body: string, use: TagUse): { from: number; to: number } {
  const hash = body.charAt(use.from - 1) === '#' ? use.from - 1 : use.from
  const marks = pairOf(body, hash, use.to)
  const from = hash - marks
  const to = use.to + marks
  const line = body.lastIndexOf('\n', from - 1) + 1
  const end = body.indexOf('\n', to)
  const after = end === -1 ? body.length : end

  if (/^\s*-\s*$/.test(body.slice(line, from)) && body.slice(to, after).trim() === '') {
    return { from: line, to: end === -1 ? body.length : end + 1 }
  }

  if (body.charAt(to) === ',') {
    return { from, to: to + 1 + spaces(body, to + 1, after) }
  }

  const before = /(,?[ \t]+|,)$/.exec(body.slice(line, from))
  if (before) return { from: from - before[0].length, to }

  return { from, to: to + spaces(body, to, after) }
}

function pairOf(body: string, from: number, to: number): number {
  let count = 0
  while (
    from - count > 0 &&
    '*_~='.includes(body.charAt(from - count - 1)) &&
    body.charAt(from - count - 1) === body.charAt(to + count)
  ) {
    count++
  }
  return count
}

function spaces(body: string, at: number, stop: number): number {
  let over = 0
  while (at + over < stop && /[ \t]/.test(body.charAt(at + over))) over++
  return over
}

function readFront(body: string, front: FrontMatterBlock, out: TagUse[]) {
  let at = front.body.from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    const line = body.slice(at, stop).replace(/\r$/, '')
    const found = KEY.exec(line)

    if (found) {
      const [, rest = ''] = found
      const value = at + line.length - rest.length
      const closes = valueClosesAt(body, value, front.close)
      if (closes !== -1) {
        const words = body
          .slice(value, closes)
          .replace(
            /(^|\s)(#\s.*)$/gm,
            (_, gap: string, comment: string) => `${gap}${' '.repeat(comment.length)}`,
          )
        readValues(value, words, out)
        at = closes + 1
        continue
      }
      readValues(value, rest, out)
      at = readItems(body, stop + 1, front, out)
      continue
    }

    if (end === -1) break
    at = end + 1
  }
}

function readItems(body: string, from: number, front: FrontMatterBlock, out: TagUse[]): number {
  let at = from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    const line = body.slice(at, stop).replace(/\r$/, '')
    const item = ITEM.exec(line)
    if (!item) return at

    const [, value = ''] = item
    readValues(at + line.indexOf(value), value, out)
    if (end === -1) return front.close
    at = end + 1
  }

  return at
}

function readValues(from: number, text: string, out: TagUse[]) {
  for (const found of text.matchAll(VALUE)) {
    const [whole] = found

    const hashed = whole.startsWith('#')
    const name = hashed ? whole.slice(1) : whole
    if (!NAME.test(name)) continue

    const at = from + found.index + (hashed ? 1 : 0)
    out.push({ tag: name, from: at, to: at + name.length })
  }
}

function readInline(body: string, front: FrontMatterBlock | null, out: TagUse[]) {
  for (const [from, to] of blocksOf(body, front ? front.to : 0)) {
    const block = body.slice(from, to)
    if (!block.includes('#')) continue

    const code = codeSpans(block)
    for (const found of block.matchAll(HASH)) {
      const at = found.index
      if (inCode(code, at)) continue
      const name = tagAt(block, at)
      if (name === null) continue

      const start = from + at + 1
      out.push({ tag: name, from: start, to: start + name.length })
    }
  }
}

const OPENS_BLOCK = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|>|#{1,6}(?:[ \t]|$))/

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/

function blocksOf(body: string, at: number): [number, number][] {
  const out: [number, number][] = []
  const code = new CodeBlocks()
  let start = -1

  while (at <= body.length) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 ? body.length : end
    const line = body.slice(at, stop)
    const words = code.line(line) === WORDS
    const blank = line.trim() === ''

    if (start !== -1 && (!words || blank || OPENS_BLOCK.test(line))) {
      out.push([start, at - 1])
      start = -1
    }
    if (words && !blank) {
      if (start === -1) start = at
      if (HEADING.test(line)) {
        out.push([start, stop])
        start = -1
      }
    }

    if (end === -1) break
    at = end + 1
  }
  if (start !== -1) out.push([start, body.length])
  return out
}
