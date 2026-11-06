import type { StateEffect } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { RunnableFence } from './door'
import { addRunLines, closeRun, dropRun, openRun, runPanels } from './panel'
import { FRAME_SCRIPT } from '../frame-text'
import { parseRunMessage, runnerDocument } from './protocol'

const RUN_TIME_LIMIT = 10_000

const RUN_START_LIMIT = 45_000

interface Sandbox {
  view: EditorView
  frame: HTMLIFrameElement
  timer: number
  listener: (event: MessageEvent) => void
  started: boolean
  finished: boolean
}

const live = new Map<number, Sandbox>()

let counter = 0

export function runFence(view: EditorView, fence: RunnableFence): boolean {
  const panels = view.state.field(runPanels, false)
  const script = FRAME_SCRIPT
  if (!panels || script === null) return false

  for (const panel of panels) {
    if (panel.from === fence.from) teardown(panel.run)
  }

  const run = ++counter
  const startedAt = Date.now()
  view.dispatch({ effects: openRun.of({ run, from: fence.from, to: fence.to, startedAt }) })

  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.title = 'nib runner'
  frame.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden'

  const expire = () => {
    const elapsed = Date.now() - startedAt
    view.dispatch({ effects: closeRun.of({ run, status: 'timeout', elapsed }) })
    teardown(run)
  }

  const listener = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return

    const message = parseRunMessage(event.data, run)
    if (!message) return

    const sandbox = live.get(run)
    if (!sandbox) return

    if (message.ready && !sandbox.started) {
      sandbox.started = true
      window.clearTimeout(sandbox.timer)
      sandbox.timer = window.setTimeout(expire, RUN_TIME_LIMIT)
    }

    const effects: StateEffect<unknown>[] = []
    if (message.lines.length) effects.push(addRunLines.of({ run, lines: message.lines }))
    if (message.done) {
      sandbox.finished = true
      effects.push(closeRun.of({ run, status: 'done', elapsed: Date.now() - startedAt }))
    }
    if (effects.length) view.dispatch({ effects })
  }

  window.addEventListener('message', listener)

  live.set(run, {
    view,
    frame,
    listener,
    timer: window.setTimeout(expire, RUN_START_LIMIT),
    started: false,
    finished: false,
  })

  frame.srcdoc = runnerDocument(fence.code, run, script)
  document.body.append(frame)

  return true
}

function teardown(run: number) {
  const sandbox = live.get(run)
  if (!sandbox) return

  live.delete(run)
  window.clearTimeout(sandbox.timer)
  window.removeEventListener('message', sandbox.listener)
  sandbox.frame.remove()
}

const runSandboxes = ViewPlugin.define((view) => ({
  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(dropRun)) teardown(effect.value)
        else if (effect.is(closeRun) && effect.value.status !== 'done') teardown(effect.value.run)
      }
    }

    const panels = update.state.field(runPanels, false)
    if (!panels || panels === update.startState.field(runPanels, false)) return

    const shown = new Set(panels.map((panel) => panel.run))
    for (const [run, sandbox] of [...live]) {
      if (sandbox.view === view && !sandbox.finished && !shown.has(run)) teardown(run)
    }
  },

  destroy() {
    for (const [run, sandbox] of [...live]) {
      if (sandbox.view === view) teardown(run)
    }
  },
}))

export const runExtension = [runPanels, runSandboxes]
