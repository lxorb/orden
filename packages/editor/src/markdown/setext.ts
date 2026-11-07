import { GFM, parser } from '@lezer/markdown'
import type { SyntaxNodeRef } from '@lezer/common'
import { ordenMarkdownExtensions, NoSetextHeadings } from './extensions'

export interface SetextEdit {
  from: number
  to: number
  insert: string
}

const UNDERLINE = /^[ \t>]*(?:[-*+]|\d+[.)])?[ \t]*(?:=+|-+)[ \t]*$/m

const withSetext = parser.configure([
  GFM,
  ...ordenMarkdownExtensions.filter((one) => one !== NoSetextHeadings),
])

const LEVEL: Readonly<Record<string, number>> = { SetextHeading1: 1, SetextHeading2: 2 }

const PREFIX = /^[ \t>]*/

function words(text: string, node: SyntaxNodeRef): string {
  const written = text.slice(node.from, node.to).split('\n')
  written.pop()

  return written
    .map((line, at) => (at === 0 ? line : line.replace(PREFIX, '')).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/(^|[ \t])(#+)[ \t]*$/, (_, space: string, hashes: string) => `${space}\\${hashes}`)
}

export function setextEdits(text: string): SetextEdit[] {
  if (!UNDERLINE.test(text)) return []

  const edits: SetextEdit[] = []
  withSetext.parse(text).iterate({
    enter: (node) => {
      const level = LEVEL[node.name]
      if (!level) return true

      if (
        level === 2 &&
        /^[ \t>]*-[ \t]*$/.test(text.slice(text.lastIndexOf('\n', node.to - 1) + 1, node.to))
      ) {
        return false
      }

      const said = words(text, node)
      if (said) edits.push({ from: node.from, to: node.to, insert: `${'#'.repeat(level)} ${said}` })
      return false
    },
  })

  return edits
}

export function withoutSetext(text: string): string {
  let out = text
  for (const edit of setextEdits(text).reverse()) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  return out
}
