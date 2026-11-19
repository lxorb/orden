import { type Tree, TreeFragment } from '@lezer/common'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownParser } from './markdown/extensions'

const TOP = Array.from({ length: 40 }, (_, at) => `Paragraph ${at} of the note above.`).join('\n\n')
const BELOW = '\n\nMore words.\n\n%%\nhidden one\n%%\n\nMiddle.\n\n%%\nhidden two\n%%\n\nEnd.\n'
function blocksIn(doc: string, tree: Tree): string[] {
  const found: string[] = []
  tree.iterate({
    enter: (node) => {
      if (node.name === 'CommentBlock') found.push(doc.slice(node.from, node.to))
    },
  })
  return found
}
function reparsedAfterDeleting(before: string, from: number, to: number) {
  const tree = ordenMarkdownParser.parse(before)
  const doc = before.slice(0, from) + before.slice(to)
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: from, toA: to, fromB: from, toB: from },
  ])
  return {
    typed: blocksIn(doc, ordenMarkdownParser.parse(doc, fragments)),
    fresh: blocksIn(doc, ordenMarkdownParser.parse(doc)),
  }
}
describe('deleting text above %% comment blocks', () => {
  test('deleting one % of an inline comment reads as a fresh parse of the note', () => {
    const before = `${TOP}\n\nWords %% inline %% more.${BELOW}`
    const at = before.indexOf('%% inline')
    const { typed, fresh } = reparsedAfterDeleting(before, at, at + 1)
    expect(typed).toEqual(fresh)
  })
  test('cutting the closing %% of an inline comment in a list item reads as a fresh parse', () => {
    const before = `${TOP}\n\n- item %%note%% done${BELOW}`
    const at = before.indexOf('%% done')
    const { typed, fresh } = reparsedAfterDeleting(before, at, at + 2)
    expect(typed).toEqual(fresh)
  })
})
