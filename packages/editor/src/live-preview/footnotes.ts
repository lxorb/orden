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

export interface FootnotePart {
  kind: 'ref' | 'def'
  label: string
  from: number
  to: number
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

function footnoteParts(state: EditorState): FootnotePart[] {
  const parts: FootnotePart[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      const part = partOf(state, ref.node)
      if (part) parts.push(part)
    },
  })
  return parts
}

export function definitionOf(state: EditorState, label: string): FootnotePart | null {
  return footnoteParts(state).find((one) => one.kind === 'def' && one.label === label) ?? null
}

export function definitionWords(state: EditorState, definition: FootnotePart): string {
  return state
    .sliceDoc(definition.labelTo, definition.to)
    .replace(/^\]:[ \t]*/, '')
    .trim()
}

const cameFrom = new WeakMap<EditorView, { label: string; at: number }>()

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

function revealed(state: EditorState, part: FootnotePart): boolean {
  return state.selection.ranges.some((range) => range.from <= part.to && range.to >= part.from)
}

const numberMark = Decoration.mark({ class: 'orden-footnote-number' })

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
    const number = target instanceof Element ? target.closest('.orden-footnote-number') : null
    if (!number) return false

    const part = footnoteAt(view.state, view.posAtDOM(number, 0), 1)
    if (!part || revealed(view.state, part)) return false
    if (!followFootnote(view, part)) return false

    event.preventDefault()
    return true
  },
})

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
        dom.className = 'orden-note-preview orden-footnote-preview'

        const name = document.createElement('div')
        name.className = 'orden-note-preview-name'
        name.textContent = part.label
        dom.append(name)

        const body = document.createElement('div')
        body.className = 'orden-note-preview-body orden-write'
        body.textContent = words
        dom.append(body)

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

export const footnoteReading: Extension = [footnoteNumbers, footnoteClicks, footnotePreviews]
