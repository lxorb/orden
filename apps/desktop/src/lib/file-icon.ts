import { frontMatterEdits } from '@orden/markdown/front-matter'
import { scalar } from '@orden/markdown/yaml'
import {
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { oneEdit, type TextEdit } from '@orden/markdown/edits'
import { isFolderNote } from './folder-notes'
import { ICON_COLOUR_KEY, ICON_KEY, readTint } from './icons'
import { key, message } from './i18n.svelte'
import { changeOf } from './search/replace'
import { settings } from './settings.svelte'
import { folderOf } from './space-paths'
import { workspace } from './workspace.svelte'

export async function setFileIcon(
  path: string,
  value: string | null,
  tint: string | null = null,
): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  if (isFolderNote(path)) workspace.setFolderIcon(folderOf(path), null)

  const colour = value === null ? null : readTint(tint)

  const edit = isWebTarget(path)
    ? await webIconEdit(path, before, value, colour)
    : isChatTarget(path)
      ? await chatIconEdit(before, value, colour)
      : isTermTarget(path)
        ? await termIconEdit(before, value, colour)
        : isCanvasTarget(path) || isPagesTarget(path)
          ? (await import('@orden/markdown/canvas')).canvasIconEdit(before, value, colour)
          : frontMatterEdits(before, [
              [ICON_KEY, value === null ? null : scalar(value)],
              [ICON_COLOUR_KEY, colour],
            ])
  if (!edit) return

  try {
    await workspace.replaceInNotes([changeOf(path, before, [edit])], { anyFile: true })
  } catch (error) {
    settings.error = message(error, key('That icon could not be written.'))
  }
}

async function webIconEdit(
  path: string,
  before: string,
  icon: string | null,
  colour: string | null,
): Promise<TextEdit | null> {
  const { readWebFile, rewriteShortcut } = await import('@orden/scan/shortcut')
  const said = /\.webloc$/i.test(path.trim()) ? null : readWebFile(path, before)
  if (!said) return null
  return oneEdit(before, rewriteShortcut(said, { chosen: icon, chosenColour: colour }))
}

async function chatIconEdit(
  before: string,
  icon: string | null,
  colour: string | null,
): Promise<TextEdit | null> {
  if (__EVEN_PLUGIN__) return null
  const { chatOf, chatText, withIcon } = await import('@orden/chats')
  const pointer = chatOf(before)
  return pointer && oneEdit(before, chatText(withIcon(pointer, icon, colour)))
}

async function termIconEdit(
  before: string,
  icon: string | null,
  colour: string | null,
): Promise<TextEdit | null> {
  if (__EVEN_PLUGIN__) return null
  const { termOf, termText } = await import('@orden/online/term')
  const term = termOf(before)
  if (!term) return null
  const plain = { v: term.v, machine: term.machine, session: term.session }
  const worn = icon === null ? plain : { ...plain, icon, ...(colour ? { iconColor: colour } : {}) }
  return oneEdit(before, termText(worn))
}
