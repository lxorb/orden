import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type SelectionRange,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { PropertiesMode } from '@orden/markdown/properties'
import { isExternal } from '../external'

export const propertiesMode = Facet.define<PropertiesMode, PropertiesMode>({
  combine: (values) => values[0] ?? 'hidden',
})

export const showFrontMatter = StateEffect.define()

export interface FrontMatterSpan {
  end: number
  after: number
}

export function frontMatterSpan(state: EditorState): FrontMatterSpan | null {
  const first = syntaxTree(state).topNode.firstChild
  if (first?.name !== 'FrontMatter' || first.from !== 0) return null
  if (first.getChildren('FrontMatterMark').length < 2) return null

  const end = state.doc.lineAt(first.to).to
  return { end, after: Math.min(end + 1, state.doc.length) }
}

const shownForNow = StateField.define<boolean>({
  create: () => false,

  update(shown, transaction) {
    if (transaction.effects.some((effect) => effect.is(showFrontMatter))) return true
    if (!shown) return false
    if (isExternal(transaction)) return false
    if (!transaction.docChanged && !transaction.selection) return true

    const span = frontMatterSpan(transaction.state)
    return !span || transaction.state.selection.main.head <= span.end
  },
})

export function drawnAs(state: EditorState): PropertiesMode {
  const asked = state.facet(propertiesMode)
  return asked === 'hidden' && state.field(shownForNow, false) === true ? 'source' : asked
}

export function shownChanged(before: EditorState, after: EditorState): boolean {
  return before.field(shownForNow, false) !== after.field(shownForNow, false)
}

export function hiddenFrontMatter(state: EditorState): FrontMatterSpan | null {
  if (state.field(shownForNow, false) !== false) return null
  if (state.facet(propertiesMode) !== 'hidden') return null
  return frontMatterSpan(state)
}

export function onThePage(state: EditorState, from: number): boolean {
  const hidden = hiddenFrontMatter(state)
  return !hidden || from > hidden.end
}

const BY_HAND = ['input.type', 'input.paste', 'input.drop', 'delete', 'move']

function byHand(transaction: Transaction): boolean {
  return (
    transaction.annotation(Transaction.userEvent) === 'input' ||
    BY_HAND.some((event) => transaction.isUserEvent(event))
  )
}

function keptClear(
  transaction: Transaction,
  hidden: FrontMatterSpan,
): Transaction | TransactionSpec | readonly TransactionSpec[] {
  const touched: { fromA: number; toA: number; text: string }[] = []
  let count = 0
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count += 1
    if (fromA <= hidden.end) touched.push({ fromA, toA, text: inserted.toString() })
  })

  const [change] = touched
  if (!change) return transaction

  if (count > 1 || transaction.isUserEvent('move')) return []

  const { fromA, toA, text } = change
  const from = hidden.after
  const to = Math.max(toA, from)
  if (to === from && text === '') return []

  const lineBreak = text !== '' && from === hidden.end ? transaction.startState.lineBreak : ''
  const insert = lineBreak + text
  const changes = transaction.startState.changes({ from, to, insert })

  const place = (at: number) => {
    if (at >= fromA && at <= fromA + text.length) return from + lineBreak.length + (at - fromA)
    const before = at < fromA ? at : at - text.length + (toA - fromA)
    return changes.mapPos(Math.max(before, from), 1)
  }
  const selection = transaction.selection
    ? EditorSelection.create(
        transaction.selection.ranges.map((range) =>
          EditorSelection.range(place(range.anchor), place(range.head)),
        ),
        transaction.selection.mainIndex,
      )
    : clampedTo(transaction.startState.selection, from).map(changes, 1)

  return {
    changes,
    selection,
    scrollIntoView: transaction.scrollIntoView,
    userEvent: transaction.annotation(Transaction.userEvent) ?? 'input',
  }
}

function clampedTo(selection: EditorSelection, from: number): EditorSelection {
  const clamp = (range: SelectionRange) =>
    EditorSelection.range(Math.max(range.anchor, from), Math.max(range.head, from))
  return EditorSelection.create(selection.ranges.map(clamp), selection.mainIndex)
}

function caretClear(
  transaction: Transaction,
): Transaction | TransactionSpec | readonly TransactionSpec[] {
  const selection = transaction.selection
  if (!selection || isExternal(transaction)) return transaction
  if (!transaction.docChanged && transaction.startState.selection.eq(selection)) return transaction

  const hidden = hiddenFrontMatter(transaction.state)
  if (!hidden) return transaction
  if (selection.ranges.every((range) => range.from >= hidden.after)) return transaction

  return [transaction, { selection: clampedTo(selection, hidden.after), sequential: true }]
}

const guard = EditorState.transactionFilter.of((transaction) => {
  if (transaction.effects.some((effect) => effect.is(showFrontMatter))) return transaction

  const hidden = hiddenFrontMatter(transaction.startState)
  if (hidden && transaction.docChanged && byHand(transaction)) {
    const kept = keptClear(transaction, hidden)
    if (kept !== transaction) return kept
  }

  return caretClear(transaction)
})

export const hiddenFrontMatterGuard: Extension = [shownForNow, guard]
