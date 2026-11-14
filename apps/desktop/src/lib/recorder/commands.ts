import type { EditorView } from '@orden/editor'
import { embedKind, parseWikilink } from '@orden/markdown/links'
import { canWriteAt } from '../sharing.svelte'
import { isMarkdownPath } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import { canRecordHere } from './container'

type Recorder = (typeof import('./recording.svelte'))['recorder']
let woken: Recorder | null = null

async function wake(): Promise<Recorder> {
  const { recorder } = await import('./recording.svelte')
  woken = recorder

  return recorder
}

export function canRecord(view?: EditorView): boolean {
  const space = workspace.activeSpace
  if (!canRecordHere() || !space || view?.state.readOnly === true) return false

  const open = workspace.active
  const into = open?.kind === 'note' && open.path && isMarkdownPath(open.path) ? open.path : null
  return canWriteAt(into ?? space.root)
}

export function recordLabel(): string {
  return woken?.on ? 'Stop recording' : 'Record'
}

export function recordingAt(view: EditorView, at: number): string | null {
  const line = view.state.doc.lineAt(at)
  const column = at - line.from

  for (const match of line.text.matchAll(/!\[\[([^\]\n]*)\]\]/g)) {
    if (column < match.index || column > match.index + match[0].length) continue

    const link = parseWikilink(match[1] ?? '', true)
    if (!link?.target) continue

    return embedKind(link.target) === 'audio' ? link.target : null
  }

  return null
}

export async function transcribeEmbed(view: EditorView, at: number) {
  const target = recordingAt(view, at)
  if (!target) return

  const { transcribeInto } = await import('./transcribing')
  await transcribeInto(view, at, target)
}

export async function record() {
  ;(await wake()).toggle()
}
