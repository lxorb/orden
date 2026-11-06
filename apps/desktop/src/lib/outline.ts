import { lines, slugify } from '@orden/markdown/links'

export interface Heading {
  level: number
  text: string
  line: number
}

const HEADING = /^(#{1,6})\s+(.*)$/

export function scanHeadings(text: string): Heading[] {
  const found: Heading[] = []
  if (!text) return found

  for (const row of lines(text)) {
    if (row.code || row.matter) continue
    const [, hashes = '', title = ''] = HEADING.exec(row.text) ?? []
    if (hashes) found.push({ level: hashes.length, text: title.trim(), line: row.line })
  }

  return found
}

export function lineOf(text: string, at: number): number {
  let line = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) line++
  return line
}

export function lineOfHeading(headings: readonly Heading[], name: string): number | null {
  const wanted = name.trim().toLowerCase()
  const anchor = slugify(name)

  return (
    headings.find(
      (heading) => heading.text.toLowerCase() === wanted || slugify(heading.text) === anchor,
    )?.line ?? null
  )
}

export function headingAt(headings: readonly Heading[], line: number): number {
  let found = -1
  for (const [index, heading] of headings.entries()) {
    if (heading.line <= line) found = index
  }
  return found
}
