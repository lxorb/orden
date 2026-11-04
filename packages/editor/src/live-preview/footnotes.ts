/** A footnote read where it is used: resting the pointer on its mark shows what it
 *  says, and pressing the mark goes to where that is written and pressing the
 *  definition's own number comes back (#1120).
 *
 *  A footnote is two things in two places - a `[^1]` in the middle of a sentence and a
 *  `[^1]: …` at the foot of the note - and reading one used to mean a panel beside the
 *  note that listed them. The mark is where the question is asked, so the answer is
 *  given there: the same card a link to another note shows, holding the definition's
 *  words drawn as the reading view draws them.
 *
 *  A plain press rather than one with the modifier, which a link wants: a link's words
 *  are words a caret goes into to fix, and a footnote's mark is a number nobody types
 *  inside. Only while the mark is drawn as its number: with the caret in it the mark is
 *  the `[^1]` it is written as, and a press there places the caret as anywhere else.
 *  The Outline lists the note's footnotes under its headings, and a row there goes to
 *  the mark; see Sidebar.svelte in the app. */

import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { noteIndex } from '../wikilink/notes'
import { renderNote } from '../wikilink/preview'

/** A footnote's mark in the words or its definition at the foot: which one, the
 *  label it names, the whole of it, and where its number is. */
export interface FootnotePart {
  kind: 'ref' | 'def'
  label: string
  from: number
  to: number
  /** Where the number inside the brackets starts and ends. */
  labelFrom: number
  labelTo: number
}

function partOf(state: EditorState, node: SyntaxNode): FootnotePart | null {
  const kind = node.name === 'FootnoteRef' ? 'ref' : node.name === 'FootnoteDef' ? 'def' : null
  if (!kind) return null
  const label = node.getChild('FootnoteLabel')
  if (!label) return null
  return {
    kind,
    label: state.sliceDoc(label.from, label.to),
    from: node.from,
    to: node.to,
    labelFrom: label.from,
    labelTo: label.to,
  }
}

/** The mark or the definition a position is inside, if any. */
export function footnoteAt(
  state: EditorState,
  pos: number,
  side: -1 | 0 | 1 = 0,
): FootnotePart | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
    node;
    node = node.parent
  ) {
    const part = partOf(state, node)
    if (part) return part
  }
  return null
}

/** Every mark and definition in the note, in the order they are written. */
function footnoteParts(state: EditorState): FootnotePart[] {
  const parts: FootnotePart[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      const part = partOf(state, ref.node)
      if (part) parts.push(part)
      // A definition holds marks of its own only rarely, and they are still marks.
    },
  })
  return parts
}

/** The definition a label names, or null where the note never wrote it. */
export function definitionOf(state: EditorState, label: string): FootnotePart | null {
  return footnoteParts(state).find((one) => one.kind === 'def' && one.label === label) ?? null
}

/** What a definition says, without its `[^1]:`. A definition is one line here, as it
 *  is to the reading view; see constructs.ts and @orden/markdown's extensions.ts. */
export function definitionWords(state: EditorState, definition: FootnotePart): string {
  return state
    .sliceDoc(definition.labelTo, definition.to)
    .replace(/^\]:[ \t]*/, '')
    .trim()
}

/** The mark the reader came from, per view, so pressing the definition's number goes
 *  back to the place in the words they left rather than to the first mark of it. */
const cameFrom = new WeakMap<EditorView, { label: string; at: number }>()

/** Where pressing a part takes the reader: from a mark to the definition's words, and
 *  from a definition back to the mark they came from, or its first mark. */
function jumpTarget(view: EditorView, part: FootnotePart): number | null {
  const state = view.state
  if (part.kind === 'ref') {
    const definition = definitionOf(state, part.label)
    if (!definition) return null
    const words = state.sliceDoc(definition.labelTo, definition.to)
    return definition.labelTo + (/^\]:?[ \t]*/.exec(words)?.[0].length ?? 0)
  }

  const marks = footnoteParts(state).filter((one) => one.kind === 'ref' && one.label === part.label)
  if (!marks.length) return null
  const back = cameFrom.get(view)
  const mark =
    back?.label === part.label
      ? (marks.find((one) => one.from <= back.at && back.at <= one.to) ?? marks[0])
      : marks[0]
  return mark ? mark.to : null
}

/** Goes from a mark to its definition or back, and answers whether it did. */
export function followFootnote(view: EditorView, part: FootnotePart): boolean {
  const to = jumpTarget(view, part)
  if (to === null) return false

  if (part.kind === 'ref') cameFrom.set(view, { label: part.label, at: part.from })
  view.dispatch({
    selection: EditorSelection.cursor(to),
    effects: EditorView.scrollIntoView(to, { y: 'center' }),
    userEvent: 'select.footnote',
  })
  view.focus()
  return true
}

/** Whether the caret is inside a part, which is when it is drawn as it is written. */
function revealed(state: EditorState, part: FootnotePart): boolean {
  return state.selection.ranges.some((range) => range.from <= part.to && range.to >= part.from)
}

/** The numbers of the marks and the definitions, as something the pointer can be
 *  told is on: a press is asked of the element it landed in, since a position read
 *  off the pointer cannot tell the right half of a superscript from the word after it. */
const numberMark = Decoration.mark({ class: 'nib-footnote-number' })

function numbers(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FootnoteLabel') return
        if (node.to > node.from) builder.add(node.from, node.to, numberMark)
      },
    })
  }
  return builder.finish()
}

const footnoteNumbers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = numbers(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = numbers(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const footnoteClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey || event.altKey) return false
    const target = event.target
    const number = target instanceof Element ? target.closest('.nib-footnote-number') : null
    if (!number) return false

    const part = footnoteAt(view.state, view.posAtDOM(number, 0), 1)
    if (!part || revealed(view.state, part)) return false
    if (!followFootnote(view, part)) return false

    event.preventDefault()
    return true
  },
})

/** How long the pointer rests on a mark before its words are shown: the same as a
 *  link's card, so the two read as one gesture. */
const DELAY = 300

const footnotePreviews = hoverTooltip(
  (view, pos, side): Tooltip | null => {
    const part = footnoteAt(view.state, pos, side < 0 ? -1 : 1)
    if (part?.kind !== 'ref') return null
    const definition = definitionOf(view.state, part.label)
    if (!definition) return null
    const words = definitionWords(view.state, definition)
    if (!words) return null

    return {
      pos: part.from,
      end: part.to,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'nib-note-preview nib-footnote-preview'

        const name = document.createElement('div')
        name.className = 'nib-note-preview-name'
        name.textContent = part.label
        dom.append(name)

        const body = document.createElement('div')
        // `nib-write` for the reason the card over a link carries it; see hover.ts.
        body.className = 'nib-note-preview-body nib-write'
        body.textContent = words
        dom.append(body)

        // Drawn as the reading view draws it; until then, and if that fails, the
        // words as written.
        void renderNote(words, view.state.facet(noteIndex).path, view.state)
          .then((html) => {
            body.innerHTML = html
          })
          .catch(() => undefined)

        return { dom }
      },
    }
  },
  {
    hoverTime: DELAY,
    hideOn: (transaction) => transaction.docChanged,
  },
)

/** The card, the jump and the numbers they are asked of. */
export const footnoteReading: Extension = [footnoteNumbers, footnoteClicks, footnotePreviews]
