import { closesFence, fenceMark } from './fences'
import { frontMatterLines } from './front-matter-lines'

export const HORIZONTAL = /^-{3,}[ \t]*$/
export const VERTICAL = /^\*{3,}[ \t]*$/
export const BLANK = /^[ \t]*$/

export function bodyStart(source: string): number {
  const matter = frontMatterLines(source)
  if (!matter) return 0

  const end = source.indexOf('\n', matter.close)
  return end === -1 ? source.length : end + 1
}

interface Line {
  from: number
  to: number
  text: string
}

export function* lines(source: string, at: number): Generator<Line> {
  for (let from = at; from <= source.length;) {
    const end = source.indexOf('\n', from)
    const to = end === -1 ? source.length : end
    const text = source.slice(from, to).replace(/\r$/, '')

    yield { from, to, text }
    if (end === -1) return
    from = end + 1
  }
}

export function fenceChange(text: string, open: string | null): string | null | undefined {
  if (open === null) return fenceMark(text) ?? undefined
  return closesFence(text, open) ? null : undefined
}

export function isDeck(source: string): boolean {
  const start = bodyStart(source)
  let fence: string | null = null
  let blank = true
  let written = false
  let broken = false

  for (const line of lines(source, start)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      if (written && broken) return true
      written = true
      blank = false
      continue
    }

    if (fence) {
      blank = false
      continue
    }

    if (blank && (HORIZONTAL.test(line.text) || VERTICAL.test(line.text))) {
      if (written) broken = true
      blank = false
      continue
    }

    if (!BLANK.test(line.text)) {
      if (broken) return true
      written = true
    }

    blank = BLANK.test(line.text)
  }

  return false
}
