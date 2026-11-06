import { syntaxTree } from '@codemirror/language'
import { Compartment, type EditorState, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { door } from '@orden/markdown/door'
import { fenceCode, fenceLanguage } from '../fence'
import { enclosingNamed } from '../nodes'
import { openViews } from '../open-views'

const RUNNABLE = new Set(['js', 'javascript', 'mjs', 'cjs'])

export function isRunnableLanguage(language: string): boolean {
  return RUNNABLE.has(language.trim().toLowerCase())
}

export interface RunnableFence {
  from: number
  to: number
  code: string
}

export function runnableFenceAt(state: EditorState, pos: number): RunnableFence | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, -1), 'FencedCode')
  if (!node || !isRunnableLanguage(fenceLanguage(state, node))) return null

  return {
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(Math.min(node.to, state.doc.length)).to,
    code: fenceCode(state, node),
  }
}

type Runner = typeof import('./run')

const runs = new Compartment()

let loaded: Runner | null = null

const loadRunner = door(() =>
  import('./run').then((module) => {
    loaded = module
    const effects = runs.reconfigure(module.runExtension)
    for (const view of openViews()) view.dispatch({ effects })

    return module
  }),
)

export function runExtension(): Extension {
  return runs.of(loaded ? loaded.runExtension : [])
}

export function runFence(view: EditorView, fence: RunnableFence): boolean {
  if (runs.get(view.state) === undefined) return false
  if (loaded) return loaded.runFence(view, fence)

  void loadRunner().then((module) => module.runFence(view, fence))

  return true
}

export function runFenceAtCursor(view: EditorView): boolean {
  const fence = runnableFenceAt(view.state, view.state.selection.main.head)
  if (!fence) return false

  return runFence(view, fence)
}
