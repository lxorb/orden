import { syntaxTree } from '@codemirror/language'
import { type EditorState, Facet, type Text } from '@codemirror/state'
import type { Tree } from '@lezer/common'

export const HEADING_LEVEL: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
}
export const headingLevel = (name: string): number | null => HEADING_LEVEL[name] ?? null
export { headingText } from '@orden/markdown/links'
export const numberHeadings = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
})
const UNNUMBERED: ReadonlyMap<number, string> = new Map()
const numbered = new WeakMap<Text, { tree: Tree; numbers: ReadonlyMap<number, string> }>()
export function headingNumbersOf(state: EditorState): ReadonlyMap<number, string> {
  if (!state.facet(numberHeadings)) return UNNUMBERED
  const tree = syntaxTree(state)
  const known = numbered.get(state.doc)
  if (known?.tree === tree) return known.numbers
  const found: { from: number; level: number }[] = []
  tree.iterate({
    enter: (node) => {
      const level = headingLevel(node.name)
      if (level === null) return node.type.isTop || node.type.is('BlockContext')
      found.push({ from: node.from, level })
      return false
    },
  })
  const top = found.reduce((least, heading) => Math.min(least, heading.level), 6)
  const numbers = new Map<number, string>()
  const counts = [0, 0, 0, 0, 0, 0]
  for (const { from, level } of found) {
    counts[level - 1] = (counts[level - 1] ?? 0) + 1
    counts.fill(0, level)
    numbers.set(from, counts.slice(top - 1, level).join('.'))
  }
  numbered.set(state.doc, { tree, numbers })
  return numbers
}
