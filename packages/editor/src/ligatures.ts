import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Prec, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { inCode } from './code'

/** How much of a note the glyphs are drawn over: nothing, the code in it, or
 *  all of it. Code only is the setting for somebody who wants `->` to be an
 *  arrow where it is an operator and two characters where it is prose. */
export type LigatureScope = 'off' | 'code' | 'all'

/** Runs of plain characters and the glyph each stands for. The glyph is what
 *  is shown; the characters are what is kept, so the file reads the same in
 *  any other editor. The fonts here have no ligatures of their own, and this
 *  way the arrows come out in prose as well as in code.
 *
 *  Drawn the way a font would draw a ligature: the characters stay in place,
 *  made invisible, and the glyph is painted over the room they take. So a
 *  run keeps its width - columns in code still line up - and reading it as
 *  typed, when the caret goes in, shifts nothing. */
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

/** Each run beside its glyph, longest first, so `<=>` is one arrow and not
 *  `<=` and a stray `>`. Paired rather than looked up again by key: the run
 *  that matched already knows what it stands for. */
const RUNS: readonly (readonly [run: string, glyph: string])[] = Object.entries(LIGATURES).sort(
  ([a], [b]) => b.length - a.length,
)
const OPENERS = new Set(RUNS.map(([run]) => run.charAt(0)))

export interface Ligature {
  from: number
  to: number
  glyph: string
}

/** Every run in `text` that has a glyph, with positions counted from
 *  `offset`. Pure: the syntax around a run is the caller's business. */
export function findLigatures(text: string, offset = 0): Ligature[] {
  const out: Ligature[] = []
  for (let at = 0; at < text.length;) {
    // Most characters open nothing, so the set answers for them before the
    // list is walked at all.
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

/** Where the characters mean something else: an address, a tag, a comment
 *  whose `-->` is its closing, or maths that is rendered on its own. */
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

/** Whether the run at `from`..`to` is text of one node that has no other use
 *  for it. A run that straddles a syntax mark - the `>` of a quote, the `==`
 *  of a highlight - is not one thing, and is left as it is. */
function standsAlone(state: EditorState, from: number, to: number): boolean {
  const tree = syntaxTree(state)
  const head = tree.resolveInner(from, 1)
  const tail = tree.resolveInner(to, -1)
  if (head.from !== tail.from || head.to !== tail.to || head.name !== tail.name) return false

  for (let node: SyntaxNode | null = head; node; node = node.parent) {
    if (LEFT_ALONE.has(node.name)) return false
  }
  return true
}

/** The runs in `ranges` that are shown as glyphs: not the one the caret is
 *  inside, which reads as typed so it can be edited, none that syntax has a
 *  claim on, and under the `code` scope none that sits in prose. */
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

/** One mark per glyph; the stylesheet paints the glyph over the run. */
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

/** Shows `->`, `<=` and their kind as the arrow or sign they stand for, over as
 *  much of the note as the scope says. Ahead of every other mark so that its
 *  span is the innermost one: the glyph then takes the colour of the token it
 *  sits in, and a code span or a bold run around it stays in one piece.
 *
 *  The scope is fixed for the life of the plugin, which is why it is a closure
 *  rather than a facet: the compartment holding this is reconfigured when the
 *  setting changes, and that is the only time it can change. Called once per
 *  scope; see `once` in modes.ts. */
export function ligatures(scope: Exclude<LigatureScope, 'off'>): Extension {
  // The caret steps into a run one character at a time, and the run reads as
  // typed while it is there - the way a font ligature opens up under the caret
  // in an editor that has them.
  return Prec.high(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildLigatures(view.state, scope, view.visibleRanges)
        }

        update(update: ViewUpdate) {
          // The parse catches up after a big paste in a transaction of its own.
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
