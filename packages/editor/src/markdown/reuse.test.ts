import { type Tree, TreeFragment } from '@lezer/common'
import { describe, expect, test } from 'vitest'
import { nibMarkdownParser } from './extensions'

function edited(doc: string, tree: Tree, at: number, removed: number, inserted: string) {
  const next = doc.slice(0, at) + inserted + doc.slice(at + removed)
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: at, toA: at + removed, fromB: at, toB: at + inserted.length },
  ])
  return { next, tree: nibMarkdownParser.parse(next, fragments) }
}

function shape(tree: Tree): string {
  const out: string[] = []
  tree.iterate({ enter: (node) => void out.push(`${node.name} ${node.from}-${node.to}`) })
  return out.join('\n')
}

function itemAt(tree: Tree, pos: number): Tree | null {
  const cursor = tree.cursor()
  while (cursor.childAfter(pos)) {
    if (cursor.name === 'ListItem' || cursor.name === 'Blockquote') return cursor.tree
  }
  return null
}

const lists = {
  tasks: (i: number) => `- [${' x'[i % 2]}] task ${i} #t${i % 30}\n`,
  bullets: (i: number) => `- item ${i}\n`,
  ordered: (i: number) => `${i + 1}. item ${i}\n`,
  nested: (i: number) => `${'  '.repeat(i % 3)}- item ${i}\n`,
}

describe('parsing again after an edit', () => {
  for (const [kind, line] of Object.entries(lists)) {
    test(`keeps the items of a long ${kind} list when the paragraph after it changes`, () => {
      const items = Array.from({ length: 400 }, (_, i) => line(i))
      const doc = `# K\n\n${items.join('')}\nend\n`
      const tree = nibMarkdownParser.parse(doc)
      const inside = `# K\n\n${items.slice(0, 201).join('')}`.length
      const before = itemAt(tree, inside)
      expect(before).not.toBeNull()

      const after = edited(doc, tree, doc.indexOf('end\n') + 3, 0, 'q')

      expect(itemAt(after.tree, inside)).toBe(before)
      expect(shape(after.tree)).toBe(shape(nibMarkdownParser.parse(after.next)))
    })
  }

  test('reads as a fresh parse after any edit', () => {
    let seed = 7
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % below
    }
    const pieces = [
      '- a\n',
      '- [ ] b\n',
      '  - c\n',
      '1. d\n',
      '> e\n',
      '\n',
      'para *x* [l](y)\n',
      '```\n',
      '    code\n',
      '# H\n',
      '---\n',
      '| a | b |\n| - | - |\n',
      '<div>\n',
      '$$\n',
    ]
    for (let round = 0; round < 60; round++) {
      let doc = Array.from({ length: 120 }, () => pieces[random(pieces.length)]).join('')
      let tree = nibMarkdownParser.parse(doc)
      for (let step = 0; step < 8; step++) {
        const at = random(doc.length + 1)
        const removed = Math.min(random(6), doc.length - at)
        const piece = pieces[random(pieces.length)] ?? ''
        const after = edited(doc, tree, at, removed, piece.slice(random(3)))
        expect(shape(after.tree), `round ${round} step ${step}`).toBe(
          shape(nibMarkdownParser.parse(after.next)),
        )
        doc = after.next
        tree = after.tree
      }
    }
  })
})
