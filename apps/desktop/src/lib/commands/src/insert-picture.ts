import type { EditorView } from '@orden/editor'
import { encodeTarget } from '@orden/markdown/links'
import { storeImage, workspace } from '../../workspace/src/api'
import { busy, message, viewport } from '../../ui-kit/src/api'
import { chooseFiles, PICTURES } from '../../ui-controls/src/api'
import { sayNotice } from '@orden/contracts'
import { usage } from '../../accounts/src/api'

export function canInsertPicture(view?: EditorView): boolean {
  return !!view && !view.state.readOnly && !!workspace.active
}
export function canTakePhoto(view?: EditorView): boolean {
  return viewport.touch && canInsertPicture(view)
}
export async function insertPicture(view: EditorView): Promise<void> {
  const [file] = await chooseFiles({ accept: PICTURES })
  if (file) await putPicture(view, file)
}
export async function takePhoto(view: EditorView): Promise<void> {
  const [file] = await chooseFiles({ accept: 'image/*', camera: true })
  if (file) await putPicture(view, file)
}
export async function putPicture(view: EditorView, file: File): Promise<void> {
  const note = workspace.active
  if (!note) return
  try {
    const src = await busy.run('Storing the image', () => storeImage(file, note.path))
    void usage.refresh()
    if (src) writeAtCaret(view, `![${alt(file.name)}](${encodeTarget(src)})`)
  } catch (error) {
    void usage.refresh()
    sayNotice(message(error, 'That image does not fit in your storage.'))
  }
}
function alt(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')
}
export function writeAtCaret(view: EditorView, text: string): void {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}
