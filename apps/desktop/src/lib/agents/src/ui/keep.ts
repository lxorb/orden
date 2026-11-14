import { workspace } from '../../../workspace.svelte'

export async function keepInNote(text: string): Promise<void> {
  const front = workspace.active

  if (front?.kind === 'note' && front.path !== null) {
    const { appendTo } = await import('../../../dictation/src/api')
    const before = front.doc.endsWith('\n\n') ? '' : front.doc.endsWith('\n') ? '\n' : '\n\n'
    if (appendTo(front.path, `${before}${text}`)) return
  }

  const path = await workspace.noteFrom(text)
  if (path !== null) await workspace.open(path)
}
