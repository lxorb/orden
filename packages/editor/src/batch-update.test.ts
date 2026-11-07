import { history, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, parseLater } from '@codemirror/language'
import { ChangeSet, EditorState, type Transaction } from '@codemirror/state'
import { ViewUpdate } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { GROWS_AT_MOST, measuredGrowth } from '../../../scripts/growth'

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
}

function edits(count: number, random: () => number): Transaction[] {
  let state = EditorState.create({ doc: 'abc\n'.repeat(400) })
  const out: Transaction[] = []
  for (let at = 0; at < count; at++) {
    const length = state.doc.length
    const from = Math.floor(random() * (length + 1))
    const to = Math.min(length, from + Math.floor(random() * 3))
    const tr = state.update({
      changes: {
        from,
        to,
        insert: random() < 0.3 ? '' : 'xy\n'.slice(0, 1 + Math.floor(random() * 3)),
      },
    })
    out.push(tr)
    state = tr.state
  }
  return out
}

function updateOf(transactions: Transaction[]): ViewUpdate {
  const first = transactions[0]
  if (!first) throw new Error('no transactions')
  const view = { state: first.startState, viewState: {} }
  return new (ViewUpdate as unknown as new (...args: unknown[]) => ViewUpdate)(
    view,
    transactions.at(-1)?.state,
    transactions,
  )
}

describe('an update of many transactions at once', () => {
  test('holds the changes of them all, composed in order', () => {
    const random = seeded(5)
    for (let round = 0; round < 200; round++) {
      const transactions = edits(1 + Math.floor(random() * 40), random)
      const one = transactions.reduce(
        (all, tr) => all.compose(tr.changes),
        ChangeSet.empty(transactions[0]?.startState.doc.length ?? 0),
      )
      expect(updateOf(transactions).changes.toJSON()).toEqual(one.toJSON())
    }
  })

  test('composes them in time that grows with their number', () => {
    const timed = (count: number) => {
      let state = EditorState.create({ doc: 'line\n'.repeat(count) })
      const transactions: Transaction[] = []
      for (let at = 1; at <= count; at++) {
        const tr = state.update({ changes: { from: state.doc.line(at).to, insert: 'x' } })
        transactions.push(tr)
        state = tr.state
      }
      const started = performance.now()
      updateOf(transactions)
      return performance.now() - started
    }
    expect(measuredGrowth(timed, 4_000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)
})

function typedOnEveryLine(
  state: EditorState,
  later: boolean,
): { state: EditorState; took: number } {
  const started = performance.now()
  for (let at = 1; at <= state.doc.lines; at++) {
    state = state.update({
      changes: { from: state.doc.line(at).to, insert: 'x' },
      userEvent: 'input.type.compose',
      annotations: later && at < state.doc.lines ? parseLater.of(true) : [],
    }).state
  }
  return { state, took: performance.now() - started }
}

describe('a run of edits joined into one undo step', () => {
  test('is undone whole, back to the note before it', () => {
    const doc = 'one\ntwo\nthree\n'.repeat(300)
    const { state } = typedOnEveryLine(EditorState.create({ doc, extensions: [history()] }), false)
    let after = state
    undo({ state, dispatch: (tr) => (after = tr.state) })
    expect(after.doc.toString()).toBe(doc)
  })

  test('is joined in time that grows with its length', () => {
    const timed = (lines: number) =>
      typedOnEveryLine(
        EditorState.create({ doc: 'line\n'.repeat(lines), extensions: [history()] }),
        false,
      ).took
    expect(measuredGrowth(timed, 4_000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)
})

describe('edits that leave the parse for later', () => {
  test('end in the tree a parse of the note gives', () => {
    const extensions = [markdown({ base: markdownLanguage })]
    const doc = Array.from({ length: 400 }, (_, at) =>
      at % 3 ? `- item ${at}` : `# head ${at}`,
    ).join('\n')
    const { state } = typedOnEveryLine(EditorState.create({ doc, extensions }), true)
    const fresh = EditorState.create({ doc: state.doc, extensions })
    const shape = (of: EditorState) => {
      const nodes: string[] = []
      ensureSyntaxTree(of, of.doc.length, 10_000)?.iterate({
        enter: (node) => {
          nodes.push(`${node.name} ${node.from} ${node.to}`)
        },
      })
      return nodes
    }
    expect(shape(state).length).toBeGreaterThan(400)
    expect(shape(state)).toEqual(shape(fresh))
  })

  test('are taken in time that grows with their number', () => {
    const timed = (lines: number) =>
      typedOnEveryLine(
        EditorState.create({
          doc: 'line\n\n'.repeat(lines),
          extensions: [markdown({ base: markdownLanguage })],
        }),
        true,
      ).took
    expect(measuredGrowth(timed, 4_000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)
})
