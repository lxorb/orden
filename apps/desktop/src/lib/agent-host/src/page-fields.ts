export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export interface Words {
  text: string
  box: Box
  size: number
}
export interface Widget {
  name: string
  box: Box
}
export interface Mark {
  box: Box
  picture: boolean
}
export interface Sheet {
  width: number
  height: number
  words: readonly Words[]
  widgets: readonly Widget[]
  marks: readonly Mark[]
}
type FieldKind = 'form' | 'box' | 'blank' | 'gap'
interface Field extends Box {
  kind: FieldKind
  question: string
  name?: string
}
export interface Read {
  size: number
  fields: Field[]
}
interface Line {
  text: string
  box: Box
}
const BLANK = /^[\s_.…-]*[_.…]{4,}[\s_.…-]*$/
const LEAST_GAP = 2.5
const PARAGRAPH = 1
const MOST_LINES = 6
const MOST_QUESTION = 400
const LARGEST_SHARE = 0.6
const COVERED = 0.15
const right = (box: Box) => box.x + box.width
const bottom = (box: Box) => box.y + box.height
const area = (box: Box) => Math.max(0, box.width) * Math.max(0, box.height)
function overlap(one: Box, other: Box): number {
  const width = Math.min(right(one), right(other)) - Math.max(one.x, other.x)
  const height = Math.min(bottom(one), bottom(other)) - Math.max(one.y, other.y)
  return width > 0 && height > 0 ? width * height : 0
}
function union(one: Box, other: Box): Box {
  const x = Math.min(one.x, other.x)
  const y = Math.min(one.y, other.y)
  return { x, y, width: Math.max(right(one), right(other)) - x, height: Math.max(bottom(one), bottom(other)) - y }
}
const inside = (box: Box, x: number, y: number) => x > box.x && x < right(box) && y > box.y && y < bottom(box)
const centred = (words: Words, box: Box) =>
  inside(box, words.box.x + words.box.width / 2, words.box.y + words.box.height / 2)
function bodySize(words: readonly Words[]): number {
  const sized = words
    .filter((one) => one.size > 0 && one.text.trim())
    .map((one) => ({ size: one.size, weight: one.text.trim().length }))
    .sort((one, other) => one.size - other.size)
  const total = sized.reduce((sum, one) => sum + one.weight, 0)
  let seen = 0
  for (const one of sized) {
    seen += one.weight
    if (seen * 2 >= total) return one.size
  }
  return 12
}
function linesOf(words: readonly Words[], size: number): Line[] {
  const sorted = [...words].sort((one, other) => one.box.y - other.box.y || one.box.x - other.box.x)
  const rows: Words[][] = []
  for (const one of sorted) {
    const row = rows.find((held) =>
      held.some((other) => {
        const shared = Math.min(bottom(one.box), bottom(other.box)) - Math.max(one.box.y, other.box.y)
        return shared >= Math.min(one.box.height, other.box.height) / 2
      }),
    )
    if (row) row.push(one)
    else rows.push([one])
  }
  return rows
    .map((row) => {
      const ordered = row.sort((one, other) => one.box.x - other.box.x)
      let text = ''
      let end: number | null = null
      for (const one of ordered) {
        const apart = end !== null && one.box.x - end > size * 0.2 && !/\s$/.test(text) && !/^\s/.test(one.text)
        text += (apart ? ' ' : '') + one.text
        end = right(one.box)
      }
      return { text: text.replace(/\s+/g, ' ').trim(), box: ordered.map((one) => one.box).reduce(union) }
    })
    .filter((line) => line.text)
    .sort((one, other) => one.box.y - other.box.y || one.box.x - other.box.x)
}
function questionFor(lines: readonly Line[], box: Box, size: number): string {
  const beside = lines.filter(
    (line) =>
      right(line.box) <= box.x + size &&
      Math.min(bottom(line.box), bottom(box)) - Math.max(line.box.y, box.y) > line.box.height / 2,
  )
  if (beside.length) return clipped(beside.map((line) => line.text).join(' '))
  const above = lines.filter((line) => bottom(line.box) <= box.y + size / 2)
  const last = above.at(-1)
  if (!last) return ''
  const taken = [last]
  for (let at = above.length - 2; at >= 0 && taken.length < MOST_LINES; at--) {
    const line = above[at]
    const next = taken[0]
    if (!line || !next || next.box.y - bottom(line.box) > size * PARAGRAPH) break
    taken.unshift(line)
  }
  return clipped(taken.map((line) => line.text).join(' '))
}
function clipped(text: string): string {
  return text.length > MOST_QUESTION ? `…${text.slice(text.length - MOST_QUESTION + 1)}` : text
}
function boxesOf(sheet: Sheet, size: number): Box[] {
  const largest = sheet.width * sheet.height * LARGEST_SHARE
  const empty = sheet.marks
    .filter((mark) => !mark.picture)
    .map((mark) => mark.box)
    .filter((box) => box.width >= size * 3 && box.height >= size * 1.5 && area(box) < largest)
    .filter((box) => !sheet.words.some((words) => words.text.trim() && centred(words, box)))
  const innermost = empty.filter(
    (box) =>
      !empty.some((other) => other !== box && area(other) < area(box) && overlap(other, box) > area(other) * 0.9),
  )
  return innermost.filter(
    (box, at) => !innermost.some((other, before) => before < at && overlap(other, box) > area(box) * 0.9),
  )
}
function inset(box: Box, by: number): Box {
  const x = Math.min(by, box.width / 4)
  const y = Math.min(by, box.height / 4)
  return { x: box.x + x, y: box.y + y, width: box.width - 2 * x, height: box.height - 2 * y }
}
function gapsOf(sheet: Sheet, lines: readonly Line[], size: number, taken: readonly Box[]): Box[] {
  const first = lines[0]
  if (!first) return []
  const left = lines.reduce((low, line) => Math.min(low, line.box.x), Infinity)
  const width = lines.reduce((high, line) => Math.max(high, right(line.box)), -Infinity) - left
  const margin = Math.min(sheet.height * 0.12, Math.max(sheet.height * 0.04, first.box.y))
  const ends = [...lines.map((line) => line.box.y).slice(1), sheet.height - margin]
  const largest = sheet.width * sheet.height * LARGEST_SHARE
  const things = sheet.marks
    .map((mark) => mark.box)
    .filter((box) => box.width > 2 && box.height > 2 && area(box) < largest)
  const out: Box[] = []
  let reach = -Infinity
  for (const [at, line] of lines.entries()) {
    reach = Math.max(reach, bottom(line.box))
    const end = ends[at] ?? reach
    if (end - reach < size * LEAST_GAP) continue
    const gap = { x: left, y: reach + size / 4, width, height: end - reach - size / 2 }
    if (taken.some((box) => overlap(box, gap) > area(box) / 2)) continue
    const covered = things.reduce((sum, box) => sum + overlap(box, gap), 0)
    if (covered > area(gap) * COVERED) continue
    out.push(gap)
  }
  return out
}
export function fieldsOf(sheet: Sheet): Read {
  const blanks = sheet.words.filter((one) => BLANK.test(one.text))
  const words = sheet.words.filter((one) => one.text.trim() && !BLANK.test(one.text))
  const size = bodySize(words)
  const lines = linesOf(words, size)
  const field = (kind: FieldKind, box: Box, name?: string): Field => ({
    kind,
    ...box,
    question: questionFor(lines, box, size),
    ...(name ? { name } : {}),
  })
  if (sheet.widgets.length) {
    return { size, fields: ordered(sheet.widgets.map((widget) => field('form', widget.box, widget.name))) }
  }
  const boxes = boxesOf(sheet, size)
  const lined = stacked(
    blanks.map((one) => ({ x: one.box.x, y: bottom(one.box) - size * 1.6, width: one.box.width, height: size * 1.6 })),
    size,
  )
  const gaps = gapsOf(sheet, lines, size, [...boxes, ...lined])
  return {
    size,
    fields: ordered([
      ...boxes.map((box) => field('box', inset(box, size / 4))),
      ...lined.map((box) => field('blank', box)),
      ...gaps.map((box) => field('gap', box)),
    ]),
  }
}
function stacked(boxes: readonly Box[], size: number): Box[] {
  const out: Box[] = []
  for (const box of [...boxes].sort((one, other) => one.y - other.y)) {
    const last = out.at(-1)
    const under =
      last &&
      Math.abs(last.x - box.x) < size &&
      Math.abs(last.width - box.width) < size * 2 &&
      box.y - bottom(last) < size * 1.5
    if (last && under) out[out.length - 1] = union(last, box)
    else out.push(box)
  }
  return out
}
function ordered(fields: Field[]): Field[] {
  return fields.sort((one, other) => one.y - other.y || one.x - other.x)
}
export function scaled(read: Read, by: number): Read {
  const round = (value: number) => Math.round(value * by)
  return {
    size: Math.round(read.size * by * 10) / 10,
    fields: read.fields.map((one) => ({
      ...one,
      x: round(one.x),
      y: round(one.y),
      width: round(one.width),
      height: round(one.height),
    })),
  }
}
