import { invoke, isNative } from './tauri'

export function placeholderOf(path: string): string {
  const at = path.lastIndexOf('/') + 1
  return `${path.slice(0, at)}.${path.slice(at)}.icloud`
}

export async function evictedHere(path: string): Promise<boolean> {
  if (!isNative) return false
  return invoke<boolean>('note_evicted', { path }).catch(() => true)
}
