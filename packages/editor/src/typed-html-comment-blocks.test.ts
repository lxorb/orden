import { type Tree, TreeFragment } from '@lezer/common'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownParser } from './markdown/extensions'

const BELOW = '\n\nMore words.\n\n%%\nhidden one\n%%\n\nMiddle.\n\n%%\nhidden two\n%%\n\nEnd.\n'
function commentBlocks(doc: string, tree: Tree): string[] {
  const found: string[] = []
  tree.iterate({
    enter: (node) => {
      if (node.name === 'CommentBlock') found.push(doc.slice(node.from, node.to))
    },
  })
  return found
}
function closedWith(before: string, at: number, typed: string): { doc: string; tree: Tree } {
  const tree = ordenMarkdownParser.parse(before)
  const doc = before.slice(0, at) + typed + before.slice(at)
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: at, toA: at, fromB: at, toB: at + typed.length },
  ])
  return { doc, tree: ordenMarkdownParser.parse(doc, fragments) }
}
describe('closing an HTML comment above %% comment blocks', () => {
  test('keeps the blocks below comments when the last > of an inline comment is typed', () => {
    const before = `Intro words here. <!--x--${BELOW}`
    const after = closedWith(before, before.indexOf('--\n') + 2, '>')
    expect(commentBlocks(after.doc, after.tree)).toEqual(['%%\nhidden one\n%%', '%%\nhidden two\n%%'])
  })
  test('keeps them comments when a comment over two lines of a paragraph is closed', () => {
    const before = `Intro words <!-- a note\nstill the note --${BELOW}`
    const after = closedWith(before, before.indexOf('--\n') + 2, '>')
    expect(commentBlocks(after.doc, after.tree)).toEqual(['%%\nhidden one\n%%', '%%\nhidden two\n%%'])
  })
  test('reads as a fresh parse of the same note', () => {
    const before = `Intro words here. <!--x--${BELOW}`
    const after = closedWith(before, before.indexOf('--\n') + 2, '>')
    expect(commentBlocks(after.doc, after.tree)).toEqual(commentBlocks(after.doc, ordenMarkdownParser.parse(after.doc)))
  })
})
