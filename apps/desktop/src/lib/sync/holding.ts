import { sha256, invoke } from '../platform/src/api'
import type { Mirror } from './mirror'

export interface Holding {
  modified?: number
  budget?: { left: number }
}

export function spend(how: Holding, size: number): boolean {
  if (!how.budget) return true
  how.budget.left -= size
  return how.budget.left >= 0
}

export async function mirrorHolds(
  mirror: Mirror,
  relative: string,
  path: string,
  how: Holding,
): Promise<boolean> {
  const note = mirror.notes[relative]
  if (note) {
    if (mirror.offered[relative] !== undefined) return false
    const words = await invoke<string>('read_note', { path }).catch(() => null)
    if (words === null || !spend(how, words.length)) return false
    return sameWords(words, note.hash)
  }

  const file = mirror.files[relative]
  if (!file) return false
  if (how.modified !== undefined && how.modified === file.modified) return true
  if (how.budget) return false
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes !== null && (await sha256(bytes)) === file.hash
}

async function sameWords(words: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(words)) === hash) return true
  return words.includes('\r') && (await sha256(words.replace(/\r\n/gu, '\n'))) === hash
}
