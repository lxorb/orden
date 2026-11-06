import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Prec, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { inCode } from './code'
import { enclosingNamed } from './nodes'

export type LigatureScope = 'off' | 'code' | 'all'

export const LIGATURES: Record<string, string> = {
  '->': '→',
  '<-': '←',
  '<->': '↔',
  '-->': '⟶',
  '<--': '⟵',
  '<-->': '⟷',
  '->>': '↠',
  '<<-': '↞',
  '=>': '⇒',
  '<=>': '⇔',
  '==>': '⟹',
  '<==': '⟸',
  '<==>': '⟺',
  '~>': '⇝',
  '<~': '⇜',
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
  ':=': '≔',
  '...': '…',
}

const RUNS: readonly (readonly [run: string, glyph: string])[] = Object.entries(LIGATURES).sort(
  ([a], [b]) => b.length - a.length,
)
const OPENERS = new Set(RUNS.map(([run]) => run.charAt(0)))

export interface Ligature {
  from: number
  to: number
  glyph: string
}

export function findLigatures(text: string, offset = 0): Ligature[] {
  const out: Ligature[] = []
  for (let at = 0; at < text.length;) {
    const found = OPENERS.has(text.charAt(at))
      ? RUNS.find(([run]) => text.startsWith(run, at))
      : undefined
    if (!found) {
      at += 1
      continue
    }
    const [run, glyph] = found
    out.push({ from: offset + at, to: offset + at + run.length, glyph })
    at += run.length
  }
  return out
}

const LEFT_ALONE = new Set([
  'URL',
  'Autolink',
  'LinkTitle',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'PercentComment',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'InlineMath',
  'BlockMath',
])

function standsAlone(state: EditorState, from: number, to: number): boolean {
  const tree = syntaxTree(state)
  const head = tree.resolveInner(from, 1)
  const tail = tree.resolveInner(to, -1)
  if (head.from !== tail.from || head.to !== tail.to || head.name !== tail.name) return false

  return enclosingNamed(head, LEFT_ALONE) === null
}

export function ligaturesIn(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
  scope: Exclude<LigatureScope, 'off'> = 'all',
): Ligature[] {
  const out: Ligature[] = []
  for (const { from, to } of ranges) {
    for (const run of findLigatures(state.sliceDoc(from, to), from)) {
      const inside = state.selection.ranges.some((one) => one.from < run.to && one.to > run.from)
      if (inside || !standsAlone(state, run.from, run.to)) continue
      if (scope === 'code' && !inCode(state, run.from)) continue

      out.push(run)
    }
  }
  return out
}

const marks = new Map<string, Decoration>()

function markFor(glyph: string): Decoration {
  let mark = marks.get(glyph)
  if (!mark) {
    mark = Decoration.mark({ class: 'nib-lig', attributes: { 'data-glyph': glyph } })
    marks.set(glyph, mark)
  }
  return mark
}

function buildLigatures(
  state: EditorState,
  scope: Exclude<LigatureScope, 'off'>,
  ranges?: readonly { from: number; to: number }[],
): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const one of ligaturesIn(state, ranges, scope)) {
    out.push(markFor(one.glyph).range(one.from, one.to))
  }
  return Decoration.set(out, true)
}

export function ligatures(scope: Exclude<LigatureScope, 'off'>): Extension {
  return Prec.high(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildLigatures(view.state, scope, view.visibleRanges)
        }

        update(update: ViewUpdate) {
          const reparsed = syntaxTree(update.state) !== syntaxTree(update.startState)
          if (update.docChanged || update.viewportChanged || update.selectionSet || reparsed) {
            this.decorations = buildLigatures(update.view.state, scope, update.view.visibleRanges)
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  )
}
