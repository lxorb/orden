/** "Open file", which means two different things.
 *
 *  On a desktop the file stays where it is: it opens from its own path, and
 *  saving writes back to that path, space or no space. In the browser there
 *  is no path to write back to, so opening means uploading. The text comes in
 *  as an unsaved note, and saving it means choosing a space to keep it in. */

import { isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

const EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt']

export async function openFile() {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Markdown', extensions: EXTENSIONS }],
    })
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
    for (const path of paths) await workspace.open(path)
    return
  }

  for (const file of await pickFiles()) {
    workspace.openBlank(stripExtension(file.name), await file.text())
  }
}

/** The browser's file chooser. It only opens from inside a click, which the
 *  menu entry is. */
function pickFiles(): Promise<File[]> {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = [...EXTENSIONS.map((one) => `.${one}`), 'text/markdown', 'text/plain'].join(',')

  return new Promise((resolve) => {
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
}
