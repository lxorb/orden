import { type OpenHow, syncStore } from '@orden/contracts'
import type { NoteDoc } from '../../documents/src/api'
import { invoke, nameOf } from '../../platform/src/api'

interface Binds {
  readonly documents: readonly NoteDoc[]
  showTab(note: NoteDoc, how: OpenHow): unknown
}
export async function boundAgain(ws: Binds, path: string, how: OpenHow): Promise<boolean> {
  const id = syncStore()?.idOf(path)
  const guest = id ? ws.documents.find((one) => one.shared === id && one.path === null) : undefined
  if (!guest) return false
  const text = await invoke<string>('read_note', { path }).catch(() => null)
  guest.adopt({ path, name: nameOf(path), text: text ?? guest.latest })
  ws.showTab(guest, how)
  return true
}
