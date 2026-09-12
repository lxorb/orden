/** The two ways in, and the row on an embed's own menu.
 *
 *  `record` and `meeting` are one command each, with one id each, and every way of
 *  reaching them runs the same function: the palette, the Paragraph menu, the editor's
 *  `/` menu, the plus on a phone, and the quick settings tile on Android. That is the
 *  whole reason this file exists rather than the store being reached for directly - an
 *  id is a thing another surface can call, and a row that built its own behaviour would
 *  be the second answer to the same question.
 *
 *  `Transcribe` is the third: a row on the menu of a recording already in a note,
 *  which sends that file through the same Whisper path a meeting's live transcript goes
 *  through and writes what came back under the embed. */

import type { EditorView } from '@nib/editor'
import { embedKind, parseWikilink } from '@nib/markdown/links'
import { busy } from '../busy.svelte'
import { key, message, t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { settings } from '../settings.svelte'
import { assetUrl, joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { i18n } from '../i18n.svelte'
import { recorder, WHISPER } from './recording.svelte'
import { canTranscribe, wordsInFile } from './transcribe'
import { languageName, transcriptCallout } from './transcript'

/** Whether the row is worth offering: a microphone, and a space to write into.
 *
 *  Not "a note open": a recording makes one where there is none, which is the whole
 *  point of a command somebody presses in a hurry. */
export function canRecord(): boolean {
  return recorder.available && !!workspace.activeSpace
}

/** And a meeting, which needs the account as well: its transcript and its summary are
 *  both on the Worker, because the key is. */
export function canTakeMeetingNotes(): boolean {
  return canRecord() && canTranscribe()
}

/** What the row says, which is the other half of one command doing two things. */
export function recordLabel(): string {
  return recorder.on && recorder.kind === 'note' ? t('Stop recording') : t('Record')
}

export function meetingLabel(): string {
  return recorder.on && recorder.kind === 'meeting' ? t('Stop the meeting') : t('Meeting notes')
}

/** Whether a `![[…]]` under the pointer names a recording, and what it names. Null for
 *  anything else, which is what keeps the row off the menu for a picture. */
export function recordingAt(view: EditorView, at: number): string | null {
  const line = view.state.doc.lineAt(at)
  const column = at - line.from

  // Found with a regular expression rather than by walking the syntax tree: the menu
  // opens at a point, and what that point is inside is a question about the line's own
  // text. The inner part is read by the package's own parser, so `![[take.weba|Sam]]`
  // is the same link here as it is to the player.
  for (const match of line.text.matchAll(/!\[\[([^\]\n]*)\]\]/g)) {
    if (column < match.index || column > match.index + match[0].length) continue

    const link = parseWikilink(match[1] ?? '', true)
    if (!link?.target) continue

    return embedKind(link.target) === 'audio' ? link.target : null
  }

  return null
}

/** The recording named by an embed, as bytes, or null where the space has no such
 *  file.
 *
 *  Asked for at the very address the player is pointed at, which is the asset protocol
 *  in the app and the asset worker in a browser, so this cannot come to a different
 *  answer about where a file is than the thing that plays it. The same resolution too:
 *  a bare name is looked for anywhere in the space, anything else is a path beside the
 *  note. See note-images.ts. */
async function bytesOf(target: string, notePath: string | null): Promise<ArrayBuffer | null> {
  const root = workspace.activeSpace?.root
  const found = root && !target.includes('/') ? links.fileNamed(target) : null
  const path = found && root ? joinPath(root, found) : beside(notePath, target)
  if (!path) return null

  const response = await fetch(assetUrl(path)).catch(() => null)
  return response?.ok ? response.arrayBuffer() : null
}

function beside(notePath: string | null, target: string): string | null {
  if (!notePath) return null
  return joinPath(notePath.replace(/[\\/][^\\/]*$/, ''), target)
}

/** Turns the recording an embed names into words, and writes them under it.
 *
 *  Under it rather than in place of it: the sound is the record and the transcript is a
 *  reading of it, and a reading that replaced the recording would throw away the one
 *  thing that cannot be got back. */
export async function transcribeEmbed(view: EditorView, at: number) {
  const target = recordingAt(view, at)
  if (!target) return

  const note = workspace.active
  const line = view.state.doc.lineAt(at)

  try {
    const words = await busy.run(t('Turning the recording into words'), async () => {
      const bytes = await bytesOf(target, note?.path ?? null)
      if (!bytes) throw new Error(key('That recording is not in this space.'))

      return wordsInFile(bytes)
    })

    if (!words.text) {
      settings.error = t('Nothing could be heard in that recording.')
      return
    }

    const said = transcriptCallout(
      words.text,
      words.language ? languageName(words.language, i18n.language) : '',
      WHISPER,
    )

    view.dispatch({
      changes: { from: line.to, to: line.to, insert: `\n\n${said}` },
      userEvent: 'input.complete',
    })
  } catch (error) {
    settings.error = message(error, key('That recording could not be turned into words.'))
  }
}

/** Starts or stops a recording. The one function the ids run. */
export function record() {
  recorder.toggle('note')
}

export function meeting() {
  recorder.toggle('meeting')
}
