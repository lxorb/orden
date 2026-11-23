import type { NoteShown } from '@orden/contracts'
import { renderOptions } from './context'

export async function notePicture(note: NoteShown, width: number): Promise<Uint8Array | null> {
  const target = { ...note, trusted: false }
  const { notePng } = await import('./exporters')
  return await notePng(target, await renderOptions(target, undefined, 'light'), width)
}
