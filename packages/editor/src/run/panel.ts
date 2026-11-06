import {
  type Transaction,
  type EditorState,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { label } from '../labels'
import { pressedByKey } from '../press'
import { NibWidget } from '../live-preview/widget'
import type { RunLine } from './protocol'

export type RunStatus = 'running' | 'done' | 'stopped' | 'timeout'

export const MAX_RUN_LINES = 500

export interface RunPanel {
  readonly run: number
  readonly from: number
  readonly to: number
  readonly status: RunStatus
  readonly lines: readonly RunLine[]
  readonly startedAt: number
  readonly elapsed: number
  readonly truncated: boolean
}

export const openRun = StateEffect.define<{
  run: number
  from: number
  to: number
  startedAt: number
}>()

export const addRunLines = StateEffect.define<{ run: number; lines: readonly RunLine[] }>()

export const closeRun = StateEffect.define<{ run: number; status: RunStatus; elapsed: number }>()

export const dropRun = StateEffect.define<number>()

const FENCE = /^[\s>]*(?:`{3,}|~{3,})/

function mapPanels(panels: readonly RunPanel[], transaction: Transaction): RunPanel[] {
  const out: RunPanel[] = []
  const changes = transaction.changes

  for (const panel of panels) {
    if (changes.touchesRange(panel.from, panel.to) === 'cover') continue

    const from = transaction.state.doc.lineAt(changes.mapPos(panel.from, 1)).from
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

export const runPanels = StateField.define<readonly RunPanel[]>({
  create: () => [],

  update(value, transaction) {
    let panels = value

    if (transaction.docChanged) {
      panels = mapPanels(panels, transaction).filter((panel) =>
        stillFenced(transaction.state, panel),
      )
    }

    for (const effect of transaction.effects) {
      const next = applyEffect(panels, effect)
      if (next) panels = next
    }

    return panels
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) => runDecorations(state, state.field(field))),
})

function runDecorations(state: EditorState, panels: readonly RunPanel[]): DecorationSet {
  const ranges: Range<Decoration>[] = []

  for (const panel of panels) {
    const line = state.doc.lineAt(Math.min(panel.to, state.doc.length))
    ranges.push(
      Decoration.widget({ widget: new RunPanelWidget(panel), block: true, side: 1 }).range(line.to),
    )
  }

  return Decoration.set(ranges, true)
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function fill(text: string, name: string, value: string | number): string {
  return text.replace(`{${name}}`, String(value))
}

class RunPanelWidget extends NibWidget {
  constructor(private readonly panel: RunPanel) {
    super()
  }

  override eq(other: RunPanelWidget) {
    const mine = this.panel
    const theirs = other.panel
    return (
      theirs.run === mine.run &&
      theirs.status === mine.status &&
      theirs.elapsed === mine.elapsed &&
      theirs.truncated === mine.truncated &&
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
      const ticker = window.setInterval(tick, 100)
      this.onDestroy(host, () => window.clearInterval(ticker))

      const stop = document.createElement('button')
      stop.className = 'nib-run-stop'
      stop.type = 'button'
      stop.textContent = label('stop')
      const halt = () =>
        view.dispatch({
          effects: closeRun.of({
            run: panel.run,
            status: 'stopped',
            elapsed: Date.now() - panel.startedAt,
          }),
        })
      stop.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        halt()
      })
      pressedByKey(stop, halt)
      bar.append(stop)
    }

    const dismiss = document.createElement('button')
    dismiss.className = 'nib-run-dismiss'
    dismiss.type = 'button'
    dismiss.title = label('dismiss')
    dismiss.setAttribute('aria-label', label('dismiss'))
    dismiss.append(cross())
    const drop = () => view.dispatch({ effects: dropRun.of(panel.run) })
    dismiss.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      drop()
    })
    pressedByKey(dismiss, drop)
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

  override ignoreEvent() {
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
