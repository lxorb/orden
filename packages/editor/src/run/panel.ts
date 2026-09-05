import { type ChangeDesc, type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { label } from '../labels'
import { NibWidget } from '../live-preview/widget'
import type { RunLine } from './protocol'

/** Where a run got to. `stopped` is the reader pressing Stop, `timeout` is the
 *  time limit running out. */
export type RunStatus = 'running' | 'done' | 'stopped' | 'timeout'

/** How many lines one panel keeps. A note that logs in a loop should not be
 *  able to grow the editor state without end. */
export const MAX_RUN_LINES = 500

export interface RunPanel {
  /** Which run this is showing, so output from a replaced run can be ignored. */
  readonly run: number
  /** Start of the fence's opening line, moved along by every edit above it. */
  readonly from: number
  /** End of the fence's closing line, which is where the panel is drawn. */
  readonly to: number
  readonly status: RunStatus
  readonly lines: readonly RunLine[]
  /** When the run began, as milliseconds, so the panel can count while it runs. */
  readonly startedAt: number
  /** How long it took, once it is over. */
  readonly elapsed: number
  /** Set once output stopped being kept, so the panel can say so. */
  readonly truncated: boolean
}

export const openRun = StateEffect.define<{
  run: number
  from: number
  to: number
  startedAt: number
}>()

export const addRunLines = StateEffect.define<{ run: number; lines: readonly RunLine[] }>()

/** Ends a run. `done` is the code finishing on its own, and leaves the sandbox
 *  standing for whatever the code left running; the other two are the run being
 *  cut short, and the sandbox goes with them (see run.ts). */
export const closeRun = StateEffect.define<{ run: number; status: RunStatus; elapsed: number }>()

/** Takes the panel away, and the sandbox with it. */
export const dropRun = StateEffect.define<number>()

/** An opening fence, indented by up to three spaces the way CommonMark allows.
 *  Used to notice that the block a panel belongs to is no longer a code block:
 *  positions can be mapped through any edit, but a fence whose backticks were
 *  deleted should not keep an output panel hanging under it. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/

function mapPanels(panels: readonly RunPanel[], changes: ChangeDesc): RunPanel[] {
  const out: RunPanel[] = []

  for (const panel of panels) {
    // A change that swallows the whole block takes its panel with it.
    if (changes.touchesRange(panel.from, panel.to) === 'cover') continue

    // The start leans right and the end leans left, so text typed at either
    // edge of the block reads as text outside it and the panel stays put.
    const from = changes.mapPos(panel.from, 1)
    const to = changes.mapPos(panel.to, -1)
    if (to <= from) continue

    out.push({ ...panel, from, to })
  }

  return out
}

function stillFenced(state: EditorState, panel: RunPanel): boolean {
  if (panel.from > state.doc.length) return false
  return FENCE.test(state.doc.lineAt(panel.from).text)
}

function applyEffect(panels: readonly RunPanel[], effect: StateEffect<unknown>): RunPanel[] | null {
  if (effect.is(openRun)) {
    const { run, from, to, startedAt } = effect.value
    // One panel per block: starting a run replaces whatever the last one left.
    const others = panels.filter((panel) => panel.from !== from)
    return [
      ...others,
      { run, from, to, status: 'running', lines: [], startedAt, elapsed: 0, truncated: false },
    ]
  }

  if (effect.is(addRunLines)) {
    const { run, lines } = effect.value
    return panels.map((panel) => {
      if (panel.run !== run) return panel
      const room = MAX_RUN_LINES - panel.lines.length
      if (room <= 0) return panel.truncated ? panel : { ...panel, truncated: true }
      return {
        ...panel,
        lines: [...panel.lines, ...lines.slice(0, room)],
        truncated: panel.truncated || lines.length > room,
      }
    })
  }

  if (effect.is(closeRun)) {
    const { run, status, elapsed } = effect.value
    return panels.map((panel) =>
      panel.run === run && panel.status === 'running' ? { ...panel, status, elapsed } : panel,
    )
  }

  if (effect.is(dropRun)) {
    return panels.filter((panel) => panel.run !== effect.value)
  }

  return null
}

/** The output panels on screen. Nothing here is ever written to the document:
 *  the field is the whole of it, so the panels are gone when the note is saved,
 *  exported, or simply reopened. */
export const runPanels = StateField.define<readonly RunPanel[]>({
  create: () => [],

  update(value, transaction) {
    let panels = value

    if (transaction.docChanged) {
      panels = mapPanels(panels, transaction.changes).filter((panel) =>
        stillFenced(transaction.state, panel),
      )
    }

    for (const effect of transaction.effects) {
      const next = applyEffect(panels, effect)
      if (next) panels = next
    }

    return panels
  },

  // Provided as a facet value rather than through a view function, which is
  // what lets it be a block widget: see blocks.ts for the same restriction.
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => runDecorations(state, state.field(field))),
})

function runDecorations(state: EditorState, panels: readonly RunPanel[]): DecorationSet {
  const ranges: Range<Decoration>[] = []

  for (const panel of panels) {
    // A block widget has to sit on a line boundary, and the mapped end of the
    // block is not always one any more.
    const line = state.doc.lineAt(Math.min(panel.to, state.doc.length))
    ranges.push(
      Decoration.widget({ widget: new RunPanelWidget(panel), block: true, side: 1 }).range(line.to),
    )
  }

  return Decoration.set(ranges, true)
}

/** The tickers counting up in the panels on screen, so they can be stopped when
 *  the panel goes. Keyed by element, since one panel can be drawn more than once. */
const TICKERS = new WeakMap<HTMLElement, number>()

/** `48 ms`, `1.4 s`. Numbers and their units, which read the same everywhere. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

/** Fills in the one placeholder the editor's labels use. */
function fill(text: string, name: string, value: string | number): string {
  return text.replace(`{${name}}`, String(value))
}

export class RunPanelWidget extends NibWidget {
  constructor(private readonly panel: RunPanel) {
    super()
  }

  eq(other: RunPanelWidget) {
    const mine = this.panel
    const theirs = other.panel
    return (
      theirs.run === mine.run &&
      theirs.status === mine.status &&
      theirs.elapsed === mine.elapsed &&
      theirs.truncated === mine.truncated &&
      // Lines are only ever appended, so the count is the whole difference.
      theirs.lines.length === mine.lines.length
    )
  }

  toDOM(view: EditorView) {
    const panel = this.panel
    const host = document.createElement('div')
    host.className = 'nib-run-panel'
    host.dataset.status = panel.status
    host.contentEditable = 'false'

    const bar = document.createElement('div')
    bar.className = 'nib-run-bar'
    host.append(bar)

    const state = document.createElement('span')
    state.className = 'nib-run-state'
    state.textContent = this.stateText()
    bar.append(state)

    const time = document.createElement('span')
    time.className = 'nib-run-time'
    bar.append(time)

    const tick = () => {
      time.textContent = formatElapsed(
        panel.status === 'running' ? Date.now() - panel.startedAt : panel.elapsed,
      )
    }
    tick()

    if (panel.status === 'running') {
      // The count is the widget's own business: driving it through the editor
      // would mean a transaction every tenth of a second.
      TICKERS.set(host, window.setInterval(tick, 100))

      const stop = document.createElement('button')
      stop.className = 'nib-run-stop'
      stop.type = 'button'
      stop.textContent = label('stop')
      stop.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        view.dispatch({
          effects: closeRun.of({
            run: panel.run,
            status: 'stopped',
            elapsed: Date.now() - panel.startedAt,
          }),
        })
      })
      bar.append(stop)
    }

    const dismiss = document.createElement('button')
    dismiss.className = 'nib-run-dismiss'
    dismiss.type = 'button'
    dismiss.title = label('dismiss')
    dismiss.setAttribute('aria-label', label('dismiss'))
    dismiss.append(cross())
    dismiss.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ effects: dropRun.of(panel.run) })
    })
    bar.append(dismiss)

    const output = document.createElement('div')
    output.className = 'nib-run-output'
    host.append(output)

    for (const line of panel.lines) {
      const row = document.createElement('div')
      row.className = 'nib-run-line'
      row.dataset.level = line.level

      if (line.level === 'result') {
        const tag = document.createElement('span')
        tag.className = 'nib-run-tag'
        tag.textContent = label('result')
        row.append(tag)
      }

      row.append(document.createTextNode(line.text))
      output.append(row)
    }

    if (panel.truncated) {
      const note = document.createElement('div')
      note.className = 'nib-run-note'
      note.textContent = fill(label('outputTruncated'), 'count', MAX_RUN_LINES)
      output.append(note)
    }

    return host
  }

  destroy(dom: HTMLElement) {
    const ticker = TICKERS.get(dom)
    if (ticker !== undefined) window.clearInterval(ticker)
    TICKERS.delete(dom)
    super.destroy(dom)
  }

  /** The widget runs its own buttons; CodeMirror should not read the clicks. */
  ignoreEvent() {
    return true
  }

  private stateText(): string {
    const panel = this.panel
    if (panel.status === 'running') return label('running')
    if (panel.status === 'stopped') return label('stopped')
    if (panel.status === 'timeout') {
      return fill(label('timedOut'), 'seconds', Math.round(panel.elapsed / 1000))
    }
    return ''
  }
}

function cross(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 14 14')

  for (const d of ['M4 4l6 6', 'M10 4l-6 6']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }

  return svg
}
