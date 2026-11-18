import type { CommandExtension } from '@orden/contracts'
import type { EditorView } from '@orden/editor'
import { embedKind, parseWikilink } from '@orden/markdown/links'
import { canTranscribe } from '../../../ai-providers/src/api'
import { canWriteAt } from '../../../sharing/src/api'
import { isMarkdownPath } from '../../../platform/src/api'
import { workspace } from '../../../workspace/src/api'
import { canDictate, dictating, toggleDictation } from '../phone/dictation'
import { canRecordHere } from './container'

let woken: (typeof import('./recording.svelte'))['recorder'] | null = null

export function canRecord(view?: EditorView): boolean {
  const space = workspace.activeSpace
  if (!canRecordHere() || !space || view?.state.readOnly === true) return false

  const open = workspace.active
  const into = open?.kind === 'note' && open.path && isMarkdownPath(open.path) ? open.path : null
  return canWriteAt(into ?? space.root)
}

export function recordRows(view?: object): CommandExtension[] {
  const editor = view as EditorView | undefined
  return [
    {
      id: 'dictate',
      label: dictating() ? 'Stop' : 'Dictate',
      byHand: true,
      disabled: !canDictate(editor),
      run: () => {
        if (editor) void toggleDictation(editor)
      },
    },
    {
      id: 'record',
      label: woken?.on ? 'Stop recording' : 'Record',
      byHand: true,
      disabled: !canRecord(editor),
      run: () =>
        void import('./recording.svelte').then(({ recorder }) => (woken = recorder).toggle()),
    },
  ]
}

function recordingAt(view: EditorView, at: number): string | null {
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

async function transcribeEmbed(view: EditorView, at: number) {
  const target = recordingAt(view, at)
  if (!target) return

  const { transcribeInto } = await import('./transcribing')
  await transcribeInto(view, at, target)
}

export function transcribeRows(spot?: object): CommandExtension[] {
  const { view, at } = (spot ?? {}) as { view?: EditorView; at?: number }
  if (!view || at === undefined || view.state.readOnly || !canTranscribe()) return []
  if (!recordingAt(view, at)) return []

  return [{ id: 'transcribe', label: 'Transcribe', run: () => void transcribeEmbed(view, at) }]
}
