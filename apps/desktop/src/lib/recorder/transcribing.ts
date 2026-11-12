import type { EditorView } from '@orden/editor'
import { busy } from '../busy.svelte'
import { region } from '../region'
import { message } from '../message'
import { links } from '../link-index.svelte'
import { settings } from '../settings.svelte'
import { assetUrl, joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { transcribedBy, wordsInFile } from './transcribe'
import { languageName, transcriptCallout } from './transcript'

async function bytesOf(target: string, notePath: string | null): Promise<ArrayBuffer | null> {
  const found = !target.includes('/') ? links.fileFor(target, notePath) : null
  const path = found ?? beside(notePath, target)
  if (!path) return null

  const response = await fetch(assetUrl(path)).catch(() => null)
  return response?.ok ? response.arrayBuffer() : null
}

function beside(notePath: string | null, target: string): string | null {
  if (!notePath) return null
  return joinPath(notePath.replace(/[\\/][^\\/]*$/, ''), target)
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
      settings.error = 'Nothing could be heard in that recording.'
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
    settings.error = message(error, 'That recording could not be turned into words.')
  }
}
