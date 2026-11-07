import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { describe, expect, test, vi } from 'vitest'
import { blockDecorations, buildBlockDecorations } from './blocks'
import { dragFreeze } from './dragging'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const looked = vi.hoisted(() => ({ paragraphs: 0 }))

vi.mock('../wikilink/embed', async (original) => {
  const actual = await original<typeof import('../wikilink/embed')>()
  return {
    ...actual,
    embedOfBlock: (...args: Parameters<typeof actual.embedOfBlock>) => {
      looked.paragraphs++
      return actual.embedOfBlock(...args)
    },
  }
})

function state(doc: string, cursor = 0) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
      ],
    }),
  )
}

function described(set: DecorationSet, doc: string): string[] {
  const out: string[] = []
  set.between(0, doc.length, (from, to, value) => {
    const widget = value.spec.widget as Record<string, unknown> | undefined
    const fields = widget
      ? Object.entries(widget)
          .filter(([key, field]) => key !== 'from' && key !== 'to' && typeof field !== 'object')
          .map(([key, field]) => `${key}=${String(field)}`)
      : []
    out.push(`${from}-${to} ${widget?.constructor.name ?? ''} ${fields.join(' ')}`)
  })
  return out
}

function widgetsIn(set: DecorationSet): unknown[] {
  const out: unknown[] = []
  set.between(0, Number.MAX_SAFE_INTEGER, (_from, _to, value) => {
    out.push(value.spec.widget)
  })
  return out
}

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n'

describe('the blocks drawn after an edit', () => {
  test('only the blocks around the edit are looked at again', () => {
    const doc = Array.from({ length: 60 }, (_, i) => `para ${i}\n\n${TABLE}\n`).join('')
    let current = state(doc, 2)
    current = current.update({ selection: EditorSelection.cursor(3) }).state
    const before = widgetsIn(current.field(blockDecorations).decorations)
    const at = doc.indexOf('| 1 |', doc.indexOf('para 30')) + 3

    current = parsed(current.update({ changes: { from: at, insert: 'z' } }).state)

    const after = widgetsIn(current.field(blockDecorations).decorations)
    expect(after).toHaveLength(60)
    expect(after.filter((widget, index) => widget === before[index])).toHaveLength(59)
    expect(described(current.field(blockDecorations).decorations, current.doc.toString())).toEqual(
      described(buildBlockDecorations(current), current.doc.toString()),
    )
  })

  test('an edit inside a long list looks again at the items around it', () => {
    const doc = `# K\n\n${Array.from({ length: 300 }, (_, i) => `- item ${i}\n`).join('')}\n${TABLE}`
    let current = state(doc, 2)
    current = current.update({ selection: EditorSelection.cursor(3) }).state
    const table = widgetsIn(current.field(blockDecorations).decorations)
    const at = doc.indexOf('item 150') + 4
    looked.paragraphs = 0

    current = parsed(current.update({ changes: { from: at, insert: ' | x\n- [ ] ' } }).state)

    expect(looked.paragraphs).toBeLessThan(10)
    expect(widgetsIn(current.field(blockDecorations).decorations)).toEqual(table)
    expect(described(current.field(blockDecorations).decorations, current.doc.toString())).toEqual(
      described(buildBlockDecorations(current), current.doc.toString()),
    )
  })

  test('are what drawing the whole note again would draw, whatever the edit', () => {
    let seed = 11
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % below
    }
    const pieces = [
      TABLE,
      '\n',
      'para *x* [l](y)\n',
      '- a\n',
      '- ![[n]]\n',
      '  - b\n',
      '1. c\n',
      '> q\n',
      '```mermaid\ngraph TD\n```\n',
      '```\n',
      '$$\nx = 1\n$$\n',
      '$$\n',
      '![[note]]\n',
      '# H\n',
      '---\nk: v\n---\n',
      '| c |\n',
      '    code\n',
      '<div>\n',
    ]
    for (let round = 0; round < 40; round++) {
      const doc = Array.from({ length: 30 }, () => pieces[random(pieces.length)] ?? '').join('')
      let current = state(doc, 0)
      current = current.update({ selection: EditorSelection.cursor(random(doc.length + 1)) }).state
      for (let step = 0; step < 12; step++) {
        const length = current.doc.length
        const at = random(length + 1)
        const kind = random(4)
        const spread = [random(length + 1), random(length + 1), random(length + 1)].sort(
          (one, other) => one - other,
        )
        const spec: TransactionSpec =
          kind === 0
            ? { selection: EditorSelection.cursor(random(length + 1)) }
            : kind === 1
              ? {
                  changes: spread.map((from, index) => ({
                    from,
                    to: Math.min(from + random(3), spread[index + 1] ?? length),
                    insert: (pieces[random(pieces.length)] ?? '').slice(random(4)),
                  })),
                }
              : {
                  changes: {
                    from: at,
                    to: Math.min(length, at + random(8)),
                    insert: (pieces[random(pieces.length)] ?? '').slice(random(4)),
                  },
                  selection: EditorSelection.cursor(at),
                }
        current = parsed(current.update(spec).state)
        const text = current.doc.toString()
        const field = current.field(blockDecorations)
        expect(field.chosen).toBe(true)
        expect(described(field.decorations, text), `round ${round} step ${step}`).toEqual(
          described(buildBlockDecorations(current), text),
        )
      }
    }
  })

  test('are what drawing the whole note would draw while its parse catches up', () => {
    const doc = Array.from(
      { length: 400 },
      (_, i) => `p ${i}\n\n${TABLE}\n$$\nx${i}\n$$\n\n- a\n`,
    ).join('')
    let current = EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
      ],
    })
    current = current.update({ selection: EditorSelection.cursor(1) }).state
    let short = 0
    const same = (label: string) => {
      const text = current.doc.toString()
      if (syntaxTree(current).length < text.length) short++
      expect(described(current.field(blockDecorations).decorations, text), label).toEqual(
        described(buildBlockDecorations(current), text),
      )
    }
    for (const share of [0.1, 0.3, 0.6, 1]) {
      current = parsed(current, Math.round(current.doc.length * share))
      same(`parsed to ${share}`)
      current = current.update({ changes: { from: 4, insert: '| x |\n' } }).state
      same(`edited at the top at ${share}`)
      const end = Math.max(0, syntaxTree(current).length - 5)
      current = current.update({ changes: { from: end, insert: '\n$$\n' } }).state
      same(`edited where the parse stops at ${share}`)
    }
    expect(short).toBeGreaterThan(3)
  })
})
