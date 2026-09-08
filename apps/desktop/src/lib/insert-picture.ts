/** A picture chosen from the disk, put into the note.
 *
 *  The same road a pasted or dropped picture takes - `storeImage`, which puts it
 *  in the account or in the folder the Attachments setting names and answers with
 *  the path the note should carry - so a picture inserted from the menu and one
 *  dragged in are the same picture in the same place. The only new part is the
 *  choosing.
 *
 *  The browser's own file chooser does that on all three builds. A webview has one
 *  too, and it hands back a real `File`, which is what the storing wants; a Tauri
 *  dialog would hand back a path and the bytes would have to be read back out of
 *  the crate to make one. */

import type { EditorView } from '@nib/editor'
import { storeImage } from './assets'
import { busy } from './busy.svelte'
import { key, message, t } from './i18n.svelte'
import { settings } from './settings.svelte'
import { usage } from './usage.svelte'
import { workspace } from './workspace.svelte'

/** What a file chooser will offer. Everything the renderer and the webview can
 *  both draw. */
const PICTURES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp']

/** Whether the row is worth offering: a note open, and open for writing. */
export function canInsertPicture(view?: EditorView): boolean {
  return !!view && !view.state.readOnly && !!workspace.active
}

export async function insertPicture(view: EditorView): Promise<void> {
  const file = await pickPicture()
  if (!file) return

  const note = workspace.active
  if (!note) return

  try {
    const src = await busy.run(t('Storing the image'), () => storeImage(file, note.path))
    void usage.refresh()
    if (src) write(view, src, file.name)
  } catch (error) {
    void usage.refresh()
    settings.error = message(error, key('That image does not fit in your storage.'))
  }
}

/** The markdown for it, where the caret is. The file's own name is the alt text:
 *  it is the only description there is at this point, and an empty one reads as a
 *  picture nobody described. */
function write(view: EditorView, src: string, name: string) {
  const alt = name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')
  const range = view.state.selection.main
  const text = `![${alt}](${src})`

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** The chooser. It only opens from inside a click, which a menu row is. */
function pickPicture(): Promise<File | null> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = [...PICTURES.map((one) => `.${one}`), 'image/*'].join(',')

  return new Promise((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
