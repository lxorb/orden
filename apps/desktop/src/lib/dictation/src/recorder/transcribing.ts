import type { EditorView } from '@orden/editor'
import { busy, message } from '../../../ui-kit/src/api'
import { region, assetUrl, joinPath } from '../../../platform/src/api'
import { links } from '../../../link-index/src/api'
import { sayNotice } from '@orden/contracts'
import { workspace } from '../../../workspace/src/api'
import { transcribedBy, wordsInFile } from './transcribe'
import { languageName, transcriptCallout } from './transcript'

async function bytesOf(target: string, notePath: string | null): Promise<ArrayBuffer | null> {
  const found = !target.includes('/') ? links.fileFor(target, notePath) : null
  const path = found ?? (notePath ? joinPath(notePath.replace(/[\\/][^\\/]*$/, ''), target) : null)
  if (!path) return null

  const response = await fetch(assetUrl(path)).catch(() => null)
  return response?.ok ? response.arrayBuffer() : null
}

export async function transcribeInto(view: EditorView, at: number, target: string) {
  const note = workspace.active
  const line = view.state.doc.lineAt(at)

  try {
    const words = await busy.run('Turning the recording into words', async () => {
      const bytes = await bytesOf(target, note?.path ?? null)
      if (!bytes) throw new Error('That recording is not in this space.')

      return wordsInFile(bytes)
    })

    if (!words.text) {
      sayNotice('Nothing could be heard in that recording.')
      return
    }

    const said = transcriptCallout(
      words.text,
      words.language ? languageName(words.language, region()) : '',
      transcribedBy(),
    )

    view.dispatch({
      changes: { from: line.to, to: line.to, insert: `\n\n${said}` },
      userEvent: 'input.complete',
    })
  } catch (error) {
    sayNotice(message(error, 'That recording could not be turned into words.'))
  }
}
