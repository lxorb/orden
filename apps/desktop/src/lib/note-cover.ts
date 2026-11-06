import { COVER_KEY, COVER_POSITION_KEY } from '@orden/markdown/cover'
import { frontMatterEdits } from '@orden/markdown/front-matter'
import { scalar } from '@orden/markdown/yaml'
import { storeImage } from './assets'
import { busy } from './busy.svelte'
import { chooseFiles, PICTURES } from './choose-files'
import { key, message, t } from './i18n.svelte'
import { changeOf } from './search/replace'
import { settings } from './settings.svelte'
import { isMarkdownPath } from './space-paths'
import { usage } from './usage.svelte'
import { workspace } from './workspace.svelte'

export function canHaveCover(path: string | null | undefined): boolean {
  return !!path && isMarkdownPath(path)
}

export async function setCover(path: string, src: string | null): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  const edit = frontMatterEdits(before, [
    [COVER_KEY, src === null ? null : scalar(src)],
    [COVER_POSITION_KEY, null],
  ])
  if (!edit) return

  try {
    await workspace.replaceInNotes([changeOf(path, before, [edit])])
  } catch (error) {
    settings.error = message(error, key('That cover could not be written.'))
  }
}

export async function chooseCover(path: string): Promise<void> {
  const [file] = await chooseFiles({ accept: PICTURES })
  if (!file) return

  try {
    const src = await busy.run(t('Storing the image'), () => storeImage(file, path))
    void usage.refresh()
    if (src) await setCover(path, src)
  } catch (error) {
    void usage.refresh()
    settings.error = message(error, key('That image does not fit in your storage.'))
  }
}

export function removeCover(path: string): Promise<void> {
  return setCover(path, null)
}
