import { COVER_KEY, COVER_POSITION_KEY } from '@orden/markdown/cover'
import { frontMatterEdits } from '@orden/markdown/front-matter'
import { storeImage } from './assets'
import { busy, message } from './ui-kit/src/api'
import { chooseFiles, PICTURES } from './choose-files'
import { changeOf } from '@orden/scan/search/replace'
import { settings } from './settings.svelte'
import { isMarkdownPath } from './platform/src/api'
import { usage } from './usage.svelte'
import { workspace } from './workspace.svelte'

export function canHaveCover(path: string | null | undefined): boolean {
  return !!path && isMarkdownPath(path)
}

export async function setCover(path: string, src: string | null): Promise<void> {
  workspace.itemMeta.set(path, { [COVER_KEY]: src, [COVER_POSITION_KEY]: null })

  const before = await workspace.noteText(path)
  if (before === null) return

  const edit = frontMatterEdits(before, [
    [COVER_KEY, null],
    [COVER_POSITION_KEY, null],
  ])
  if (!edit) return

  try {
    await workspace.replaceInNotes([changeOf(path, before, [edit])])
  } catch (error) {
    settings.error = message(error, 'That cover could not be written.')
  }
}

export async function chooseCover(path: string): Promise<void> {
  const [file] = await chooseFiles({ accept: PICTURES })
  if (!file) return

  try {
    const src = await busy.run('Storing the image', () => storeImage(file, path))
    void usage.refresh()
    if (src) await setCover(path, src)
  } catch (error) {
    void usage.refresh()
    settings.error = message(error, 'That image does not fit in your storage.')
  }
}

export function removeCover(path: string): Promise<void> {
  return setCover(path, null)
}
