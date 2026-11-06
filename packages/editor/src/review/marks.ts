import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  type Tooltip,
} from '@codemirror/view'
import { label } from '../labels'
import { NibWidget } from '../live-preview/widget'
import { type SharedDoc, sharedOf } from '../shared'

export interface ReviewMark {
  id: string
  from: number
  to: number
  removed: string
  fading?: boolean
}

export const setReviewMarks = StateEffect.define<readonly ReviewMark[]>()

let source: ((doc: SharedDoc) => readonly ReviewMark[]) | null = null
let actions: ((id: string, keep: boolean) => void) | null = null

export function setReviewSource(ask: (doc: SharedDoc) => readonly ReviewMark[]) {
  source = ask
}

export function setReviewActions(act: (id: string, keep: boolean) => void) {
  actions = act
}

const SHOWN = 120

class Removed extends NibWidget {
  constructor(
    private readonly words: string,
    private readonly fading: boolean,
  ) {
    super()
  }

  override eq(other: Removed): boolean {
    return other.words === this.words && other.fading === this.fading
  }

  override toDOM(): HTMLElement {
    const struck = document.createElement('del')
    struck.className = 'cm-review-removed'
    if (this.fading) struck.classList.add('is-fading')
    const flat = this.words.replace(/\s+/g, ' ').trim()
    struck.textContent = flat.length > SHOWN ? `${flat.slice(0, SHOWN)}…` : flat || '¶'
    struck.title = this.words
    return struck
  }

  override ignoreEvent(): boolean {
    return false
  }
}

interface Held {
  marks: readonly ReviewMark[]
  drawn: DecorationSet
}

function drawn(state: EditorState, marks: readonly ReviewMark[]): Held {
  const length = state.doc.length
  const kept: ReviewMark[] = []
  const ranges: Range<Decoration>[] = []
  const lines = new Set<number>()

  for (const mark of marks) {
    const from = Math.min(Math.max(0, mark.from), length)
    const to = Math.min(Math.max(from, mark.to), length)
    if (to === from && !mark.removed) continue
    kept.push({ ...mark, from, to })

    const fading = mark.fading ? ' is-fading' : ''
    if (mark.removed) {
      ranges.push(
        Decoration.widget({ widget: new Removed(mark.removed, !!mark.fading), side: -1 }).range(
          from,
        ),
      )
    }
    if (to > from) {
      ranges.push(
        Decoration.mark({
          class: `cm-review-added${fading}`,
          attributes: { 'data-review': mark.id },
        }).range(from, to),
      )
    }
    if (mark.fading) continue
    for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line++)
      lines.add(line)
  }

  for (const line of lines) {
    ranges.push(Decoration.line({ class: 'cm-review-line' }).range(state.doc.line(line).from))
  }

  return { marks: kept, drawn: Decoration.set(ranges, true) }
}

const none: Held = { marks: [], drawn: Decoration.none }

function asked(state: EditorState): Held {
  const doc = sharedOf(state)
  return doc && source ? drawn(state, source(doc)) : none
}

const field = StateField.define<Held>({
  create: asked,
  update(held, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setReviewMarks)) return drawn(transaction.state, effect.value)
    }
    if (sharedOf(transaction.state) !== sharedOf(transaction.startState))
      return asked(transaction.state)
    if (!transaction.docChanged || !held.marks.length) return held

    const changes = transaction.changes
    return {
      marks: held.marks.map((mark) => {
        const from = changes.mapPos(mark.from, 1)
        return { ...mark, from, to: Math.max(from, changes.mapPos(mark.to, -1)) }
      }),
      drawn: held.drawn.map(changes),
    }
  },
  provide: (one) => EditorView.decorations.from(one, (held) => held.drawn),
})

function changeAt(state: EditorState, at: number): ReviewMark | null {
  const held = state.field(field, false)
  return (
    held?.marks.find(
      (mark) => !mark.fading && mark.from <= at && at <= Math.max(mark.to, mark.from + 1),
    ) ?? null
  )
}

const offer = hoverTooltip(
  (view, at): Tooltip | null => {
    const mark = changeAt(view.state, at)
    if (!mark || !actions) return null
    const act = actions
    return {
      pos: mark.from,
      end: mark.to,
      above: true,
      create() {
        const bar = document.createElement('div')
        bar.className = 'cm-review-offer'
        for (const keep of [false, true]) {
          const button = bar.appendChild(document.createElement('button'))
          button.type = 'button'
          button.textContent = label(keep ? 'keep' : 'undo')
          button.className = keep ? 'is-keep' : 'is-undo'
          button.addEventListener('mousedown', (event) => {
            event.preventDefault()
          })
          button.addEventListener('click', () => {
            act(mark.id, keep)
          })
        }
        return { dom: bar }
      },
    }
  },
  { hoverTime: 250 },
)

const style = EditorView.baseTheme({
  '.cm-review-added': {
    backgroundColor: 'color-mix(in srgb, var(--success) 16%, transparent)',
    borderRadius: '2px',
  },
  '.cm-review-removed': {
    color: 'var(--danger)',
    backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
    borderRadius: '2px',
    marginInlineEnd: '2px',
    textDecorationThickness: '1px',
  },
  '.cm-review-line': {
    boxShadow: 'inset 2px 0 0 color-mix(in srgb, var(--success) 70%, transparent)',
  },
  '.cm-review-added.is-fading, .cm-review-removed.is-fading': {
    animation: 'cm-review-fade var(--dur-stage) var(--ease-out) forwards',
  },
  '@keyframes cm-review-fade': {
    to: { backgroundColor: 'transparent', color: 'inherit' },
  },
  '.cm-review-offer': {
    display: 'flex',
    gap: '2px',
    padding: '2px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    boxShadow: 'var(--shadow-sm)',
  },
  '.cm-review-offer button': {
    font: 'inherit',
    fontSize: 'var(--text-xs)',
    padding: '1px 8px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text)',
    cursor: 'pointer',
    transition: 'background var(--dur-instant) var(--ease-out)',
  },
  '.cm-review-offer button:hover': { background: 'var(--surface-3)' },
  '.cm-review-offer button:active': { background: 'var(--press)' },
  '.cm-review-offer .is-keep': { color: 'var(--success)' },
})

const extension: Extension = [field, offer, style]

export function reviewMarks(): Extension {
  return extension
}

export function reviewMarksOf(state: EditorState): readonly ReviewMark[] {
  return state.field(field, false)?.marks ?? []
}
