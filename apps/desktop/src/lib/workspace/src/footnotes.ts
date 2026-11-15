import { lines } from '@orden/markdown/links'

export interface Footnote {
  id: string
  text: string
  line: number
  defined: number | null
  used: boolean
}

const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/

const REFERENCE = /\[\^([^\]\s]+)\]/g

export function scanFootnotes(text: string): Footnote[] {
  if (!text.includes('[^')) return []

  const said = new Map<string, string>()
  const definedAt = new Map<string, number>()
  const order: string[] = []
  const usedAt = new Map<string, number>()

  for (const { text: row, line, code } of lines(text)) {
    if (code) continue

    const defined = DEFINITION.exec(row)
    if (defined) {
      const id = defined[1] ?? ''
      if (!said.has(id)) {
        said.set(id, (defined[2] ?? '').trim())
        definedAt.set(id, line)
      }
    }

    for (const found of row.matchAll(REFERENCE)) {
      const id = found[1] ?? ''
      if (defined && found.index === 0) continue
      if (!usedAt.has(id)) {
        usedAt.set(id, line)
        order.push(id)
      }
    }
  }

  const unused = [...said.keys()].filter((id) => !usedAt.has(id))

  return [...order, ...unused].map((id) => ({
    id,
    text: said.get(id) ?? '',
    line: usedAt.get(id) ?? definedAt.get(id) ?? 0,
    defined: definedAt.get(id) ?? null,
    used: usedAt.has(id),
  }))
}
