import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import type { PropertiesMode } from '@orden/markdown/properties'
import { describe, expect, test } from 'vitest'
import { blockDecorations } from './blocks'
import { propertiesMode } from './hidden-front-matter'
import { ChartWidget, DiagramWidget, MathWidget } from './render'
import { dragFreeze, setDragging } from './dragging'
import { external } from '../external'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

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

function afterMove(doc: string, from: number, to: number) {
  const before = state(doc, from)
  const was = before.field(blockDecorations)
  const now = parsed(before.update({ selection: EditorSelection.cursor(to) }).state)
  return { was, is: now.field(blockDecorations) }
}

function spans(doc: string, cursor = 0): string[] {
  return state(doc, cursor)
    .field(blockDecorations)
    .spans.map((span) => doc.slice(span.from, span.to))
}

const asked = new Compartment()

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |'
const PROSE = 'one **two** three [four](five) `six`\n\nseven eight nine\n\n'
const FILLER = 'prose with **emphasis** and a [link](x).\n\n'.repeat(200)

describe('block decorations', () => {
  test('records where the constructs that mind the caret are', () => {
    expect(spans(`${PROSE}${TABLE}`)).toEqual([TABLE])
    expect(spans('$$\nx = 1\n$$')).toEqual(['$$\nx = 1\n$$'])
    expect(spans('```mermaid\ngraph TD\n```')).toEqual(['```mermaid\ngraph TD\n```'])
    expect(spans('[toc]')).toEqual(['[toc]'])
  })

  test('prose is not a place the caret changes anything', () => {
    expect(spans(PROSE)).toEqual([])
  })

  test('every fence is a place worth looking at again, whatever its language', () => {
    const fence = '```js\nlet x = 1\n```'
    expect(spans(`${PROSE}${fence}`)).toEqual([fence])
  })

  test('a table with something before its pipes is left as source', () => {
    const indented = `- item\n\n  ${TABLE.split('\n').join('\n  ')}\n`
    expect(spans(indented)).toEqual([])
    expect(state(indented).field(blockDecorations).decorations.size).toBe(0)

    const quoted = `> ${TABLE.split('\n').join('\n> ')}\n`
    expect(spans(quoted)).toEqual([])
    expect(state(quoted).field(blockDecorations).decorations.size).toBe(0)
  })

  test('a table of its own still renders', () => {
    expect(state(`${PROSE}${TABLE}`).field(blockDecorations).decorations.size).toBe(1)
  })

  test('an equation or a diagram with something before it is left as source too', () => {
    for (const doc of [
      '> $$\n> x = 1\n> $$\n',
      '- item\n\n  $$\n  x = 1\n  $$\n',
      '> ```mermaid\n> graph TD\n> ```\n',
      '- item\n\n  ```mermaid\n  graph TD\n  ```\n',
    ]) {
      expect(state(doc, doc.length - 1).field(blockDecorations).decorations.size, doc).toBe(0)
    }
  })

  test('a formula written on one line is handed to the renderer, not an empty string', () => {
    for (const [doc, tex] of [
      ['$$x + y = z$$\n\ntail\n', 'x + y = z'],
      ['$$\nx + y = z\n$$\n\ntail\n', 'x + y = z'],
      ['$$x$$\n\ntail\n', 'x'],
    ] as const) {
      const found = state(doc, doc.length - 1).field(blockDecorations).decorations
      const widgets: string[] = []
      found.between(0, doc.length, (_from, _to, value) => {
        const widget = value.spec.widget as { tex?: string } | undefined
        if (widget && typeof widget.tex === 'string') widgets.push(widget.tex)
      })

      expect(widgets, doc).toEqual([tex])
    }
  })

  test('nothing is revealed by the caret a document opens with', () => {
    for (const doc of [
      `${TABLE}\n\ntail\n`,
      '$$\nx = 1\n$$\n\ntail\n',
      '```mermaid\ngraph TD\n```\n\ntail\n',
      '[toc]\n\n# One\n',
    ]) {
      expect(state(doc).field(blockDecorations).decorations.size, doc).toBe(1)
    }
  })

  test('nor by the caret that arrives with a note being opened', () => {
    const opened = parsed(
      state('x\n').update({
        changes: { from: 0, to: 1, insert: `${TABLE}\n\ntail` },
        annotations: external.of(true),
      }).state,
    )

    expect(opened.field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by the parse of a long note catching up with it', () => {
    const long = `${TABLE}\n\n${FILLER}`

    expect(state(long).field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by a caret a long note is reopened well inside', () => {
    const long = `${FILLER}${TABLE}\n\ntail\n`
    const inside = long.indexOf('| a')

    expect(state(long, inside).field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by a transaction that states the caret it already had', () => {
    const doc = `${TABLE}\n\ntail\n`
    const held = state(doc)
    const again = held.update({ selection: held.selection }).state

    expect(again.field(blockDecorations).decorations.size).toBe(1)
  })

  test('but the caret does reveal once it has been put somewhere', () => {
    const doc = `${TABLE}\n\ntail\n`
    const moved = state(doc).update({ selection: EditorSelection.cursor(3) }).state
    expect(moved.field(blockDecorations).decorations.size).toBe(0)
  })

  test('a caret that stays clear of them all rebuilds nothing', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, 20)
    expect(is).toBe(was)
  })

  test('a caret arriving in one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, doc.length - 2)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(0)
  })

  test('a caret leaving one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, doc.length - 2, 0)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(1)
  })
})

describe('a caret put where a block is drawn', () => {
  function caretAt(doc: string, at: number) {
    const parked = state(doc, at === 0 ? doc.length : 0)
    return parsed(parked.update({ selection: EditorSelection.cursor(at) }).state)
  }

  function overCaret(doc: string, at: number): string[] {
    const found: string[] = []
    caretAt(doc, at)
      .field(blockDecorations)
      .decorations.between(0, doc.length, (from, to) => {
        if (from < to && at >= from && at <= to) found.push(doc.slice(from, to))
      })
    return found
  }

  test('the space after a closing $$ is part of the formula, not a hole in it', () => {
    const doc = 'intro\n\n$$x = 1$$ \ntail\n'
    const end = doc.indexOf(' \ntail') + 1
    const now = caretAt(doc, end)

    expect(now.selection.main.head).toBe(end)
    expect(overCaret(doc, end)).toEqual([])
    expect(drawn(now.field(blockDecorations), doc)).toEqual([])
  })

  test('and the formula is drawn again on the way out', () => {
    const doc = 'intro\n\n$$x = 1$$ \ntail\n'
    const end = doc.indexOf(' \ntail') + 1
    const out = parsed(
      caretAt(doc, end).update({ selection: EditorSelection.cursor(doc.indexOf('tail')) }).state,
    )

    expect(out.selection.main.head).toBe(doc.indexOf('tail'))
    expect(drawn(out.field(blockDecorations), doc)).toEqual(['$$x = 1$$ '])
  })

  const blocks: [string, string][] = [
    ['a formula on one line', '$$x = 1$$'],
    ['a formula with a space after it', '$$x = 1$$ '],
    ['a formula with two spaces after it', '$$x = 1$$  '],
    ['a formula on three lines', '$$\nx = 1\n$$'],
    ['a formula with a space after its closing mark', '$$\nx = 1\n$$ '],
    ['a diagram', '```mermaid\ngraph TD\n```'],
    ['a diagram with a space after its fence', '```mermaid\ngraph TD\n``` '],
    ['a table', TABLE],
    ['a table with a space after its last row', `${TABLE} `],
    ['a toc', '[toc]'],
    ['a toc with a space after it', '[toc] '],
  ]

  for (const [what, block] of blocks) {
    test(`${what} shows its source wherever the caret is put in it`, () => {
      const doc = `intro\n\n${block}\n\n# One\n\ntail\n`
      const from = doc.indexOf(block)

      for (let at = from; at <= from + block.length; at++) {
        expect(overCaret(doc, at), `${what} at ${at - from}`).toEqual([])
      }
    })

    test(`${what} is drawn again once the caret is off its lines`, () => {
      const doc = `intro\n\n${block}\n\n# One\n\ntail\n`
      const from = doc.indexOf(block)

      for (const at of [from - 2, doc.indexOf('tail')]) {
        const still = drawn(caretAt(doc, at).field(blockDecorations), doc)
        expect(still, `${what} from ${at}`).toContain(block)
      }
    })
  }
})

describe('a press on a block that is drawn', () => {
  test('a rendered formula hands the press to the editor', () => {
    expect(new MathWidget('x = 1', true).ignoreEvent()).toBe(false)
  })

  test('so do a diagram and a chart, which hold nothing to press either', () => {
    expect(new DiagramWidget('graph TD', 'mermaid').ignoreEvent()).toBe(false)
    expect(new ChartWidget('a, 1').ignoreEvent()).toBe(false)
  })

  test('inline maths keeps its press: a row of words has somewhere to land', () => {
    expect(new MathWidget('E', false).ignoreEvent()).toBe(true)
  })
})

function afterTyping(doc: string, at: number, insert: string, to = at) {
  const before = state(doc, at)
  const was = before.field(blockDecorations)
  const now = parsed(
    before.update({
      changes: { from: at, to, insert },
      selection: { anchor: at + insert.length },
    }).state,
  )
  return { was, is: now.field(blockDecorations), state: now }
}

function drawn(blocks: { decorations: { between: unknown } }, doc: string): string[] {
  const out: string[] = []
  ;(blocks.decorations as import('@codemirror/view').DecorationSet).between(
    0,
    doc.length,
    (from, to) => {
      out.push(doc.slice(from, to))
    },
  )
  return out
}

describe('prose typed away from every construct', () => {
  const doc = `${PROSE}${TABLE}`

  test('moves the constructs along without looking for them again', () => {
    const { was, is, state: after } = afterTyping(doc, 4, 'word')
    expect(is.spans).not.toBe(was.spans)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('a line break is not prose: it is looked at properly', () => {
    const { was, is } = afterTyping(doc, 4, '\n')
    expect(is.spans).not.toEqual(was.spans)
    expect(is.decorations.size).toBe(1)
  })

  test('a bar could make a table row, so it is looked at properly', () => {
    const found = afterTyping(`${PROSE}| a | b |\n| - | - |\n`, 0, '| c |\n')
    expect(found.is.decorations.size).toBe(1)
  })

  test('a construct typed into is rebuilt, not shifted', () => {
    const at = doc.length - 2
    const { is } = afterTyping(doc, at, 'z')
    expect(is.decorations.size).toBe(0)
  })

  test('dollars are not prose either', () => {
    const opened = `${PROSE}$$\nx\n\nmore prose after it\n`
    const at = opened.indexOf('\n\nmore')
    const { was, is } = afterTyping(opened, at + 1, '$$\n')
    expect(was.spans[0]?.to).toBe(opened.length)
    expect(is.spans[0]?.to).toBe(at + 3)
  })

  test('a note with a toc is always looked at again: a heading elsewhere changes it', () => {
    const withToc = `[toc]\n\n# One\n\nsome prose here\n`
    const at = withToc.indexOf('# One') + 2
    const { is, state: after } = afterTyping(withToc, at, 'Two ')
    expect(drawn(is, after.doc.toString())).toEqual(['[toc]'])
  })

  test('deleting prose shifts the constructs too', () => {
    const { is, state: after } = afterTyping(doc, 4, '', 8)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('a language written into a plain fence is not prose written nowhere', () => {
    const plain = 'intro\n\n```\ngraph TD\n```\n\ntail\n'
    const at = plain.indexOf('```') + 3
    const after = parsed(state(plain).update({ changes: { from: at, insert: 'mermaid' } }).state)

    expect(drawn(after.field(blockDecorations), after.doc.toString())).toEqual([
      '```mermaid\ngraph TD\n```',
    ])
  })

  test('an equation uncovered by deleting the word in front of it is found', () => {
    const covered = `${PROSE}x$$E = mc^2$$\n\ntail\n`
    const at = covered.indexOf('x$$')
    const { was, is, state: after } = afterTyping(covered, at, '', at + 1)
    const text = after.doc.toString()

    expect(was.spans).toEqual([])
    expect(is.spans.map((span) => text.slice(span.from, span.to))).toEqual(['$$E = mc^2$$'])
  })

  test('punctuation typed inside a line moves the constructs along', () => {
    const { is, state: after } = afterTyping(doc, 4, '. Then: (a) - b!')
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('but punctuation at the head of a line is looked at properly', () => {
    const top = '--\ntitle: x\n---\n\nbody\n'
    const { was, is } = afterTyping(top, 0, '-')
    expect(was.decorations.size).toBe(0)
    expect(is.decorations.size).toBe(1)
  })

  test('a toc completed by deleting the words after it is drawn', () => {
    const draft = 'intro\n\n[toc] draft\n\n# One\n'
    const from = draft.indexOf('[toc]') + '[toc]'.length
    const after = parsed(
      state(draft).update({ changes: { from, to: from + ' draft'.length } }).state,
    )

    expect(drawn(after.field(blockDecorations), after.doc.toString())).toEqual(['[toc]'])
  })
})

describe('a selection dragged over a rendered block', () => {
  function shown(state: EditorState): boolean {
    return state.field(blockDecorations).decorations.size > 0
  }

  function dragged(doc: string, inside: number, outside: number, events = 6) {
    let now = state(doc, 0).update({ effects: setDragging.of(true) }).state
    const steps = [shown(now)]

    for (let event = 0; event < events; event++) {
      const head = shown(now) ? inside : outside
      now = now.update({
        selection: EditorSelection.range(0, head),
        userEvent: 'select.pointer',
      }).state
      steps.push(shown(now))
    }

    return { steps, settled: shown(now.update({ effects: setDragging.of(false) }).state) }
  }

  const blocks: [string, string][] = [
    ['a table', TABLE],
    ['a display equation', '$$\nx = 1\n$$'],
    ['a diagram', '```mermaid\ngraph TD\n```'],
  ]

  for (const [what, block] of blocks) {
    const doc = `${PROSE}${block}`
    const inside = PROSE.length + 2
    const outside = 4

    test(`${what} keeps one state for as long as the button is down`, () => {
      expect(new Set(dragged(doc, inside, outside).steps)).toEqual(new Set([true]))
    })

    test(`${what} settles once, on the way up`, () => {
      expect(dragged(doc, inside, outside).settled).toBe(false)
    })
  }

  test('a caret moved by the keyboard still reveals as it goes', () => {
    const doc = `${PROSE}${TABLE}`
    const { is } = afterMove(doc, 0, doc.length - 2)
    expect(is.decorations.size).toBe(0)
  })

  test('a drag interrupted anywhere leaves nothing held', () => {
    const doc = `${PROSE}${TABLE}`
    const held = state(doc, 0)
      .update({ effects: setDragging.of(true) })
      .state.update({
        selection: EditorSelection.range(0, doc.length - 2),
        userEvent: 'select.pointer',
      }).state

    expect(held.field(blockDecorations).decorations.size).toBe(1)
    const released = held.update({ effects: setDragging.of(false) }).state
    expect(released.field(blockDecorations).decorations.size).toBe(0)
  })

  test('a note swapped in under a held pointer is still drawn for its reader', () => {
    const held = state('x\n', 0).update({ effects: setDragging.of(true) }).state
    const opened = parsed(
      held.update({
        changes: { from: 0, to: 1, insert: `${TABLE}\n\ntail` },
        annotations: external.of(true),
      }).state,
    )

    expect(opened.field(blockDecorations).decorations.size).toBe(1)
  })
})

describe('a note cover', () => {
  const COVERED = '---\ntitle: Wide\ncover: assets/wide.jpg\n---\n\n# Wide\n\nWords.\n'

  const covers = (doc: string, cursor = 0) => {
    let found = 0
    state(doc, cursor)
      .field(blockDecorations)
      .decorations.between(0, doc.length, (_from, _to, value) => {
        if (value.spec.widget?.constructor.name === 'CoverWidget') found += 1
      })
    return found
  }

  test('is drawn for a note that names one', () => {
    expect(covers(COVERED)).toBe(1)
  })

  test('is not drawn for a note that names none', () => {
    expect(covers('---\ntitle: Wide\n---\n\n# Wide\n')).toBe(0)
  })

  test('stays drawn while the caret is inside the front matter', () => {
    expect(covers(COVERED, COVERED.indexOf('cover:') + 3)).toBe(1)
  })
})

describe('what the front matter is drawn as', () => {
  const NOTE = '---\ntitle: A note\ntags: [one]\n---\n\n# Head\n'

  const built = (mode: PropertiesMode, cursor = NOTE.length - 1) =>
    parsed(
      EditorState.create({
        doc: NOTE,
        selection: EditorSelection.cursor(cursor),
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          dragFreeze,
          propertiesMode.of(mode),
          blockDecorations,
        ],
      }),
    ).field(blockDecorations)

  const widgets = (mode: PropertiesMode, cursor?: number) => {
    const names: (string | null)[] = []
    built(mode, cursor).decorations.between(0, NOTE.length, (_from, _to, value) => {
      names.push(value.spec.widget?.constructor.name ?? null)
    })
    return names
  }

  test('is the rows where the reader asked for the rows', () => {
    expect(widgets('properties')).toEqual(['PropertiesWidget'])
  })

  test('is the source, always, where the reader asked for the source', () => {
    expect(widgets('source')).toEqual([])
    expect(widgets('source', 0)).toEqual([])
  })

  test('is nothing at all where the reader asked for nothing', () => {
    expect(widgets('hidden')).toEqual([null])
  })

  test('and changing the answer redraws without the note or the caret moving', () => {
    const state = parsed(
      EditorState.create({
        doc: NOTE,
        selection: EditorSelection.cursor(NOTE.length - 1),
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          dragFreeze,
          asked.of(propertiesMode.of('properties')),
          blockDecorations,
        ],
      }),
    )

    expect(state.field(blockDecorations).decorations.size).toBe(1)
    const after = state.update({ effects: asked.reconfigure(propertiesMode.of('hidden')) }).state
    const names: (string | null)[] = []
    after.field(blockDecorations).decorations.between(0, NOTE.length, (_f, _t, value) => {
      names.push(value.spec.widget?.constructor.name ?? null)
    })

    expect(names).toEqual([null])
  })
})
