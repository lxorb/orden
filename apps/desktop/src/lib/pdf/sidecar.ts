import { log } from '../log'
import { invoke } from '../tauri'
import { frozen, type Held, leftAlone, readSheet, type Sheet, writeSheet } from './highlights'

export async function loadHighlights(path: string): Promise<Sheet> {
  const text = await invoke<string>('read_highlights', { path }).catch((error: unknown) => {
    log('warn', `highlights: ${path} - ${String(error)}`)
    return null
  })
  return text === null ? leftAlone('unreadable') : readSheet(text)
}

const turns = new Map<string, Promise<unknown>>()

export function editHighlights(
  path: string,
  change: (sheet: Sheet) => Sheet,
): Promise<Sheet | Held> {
  const turn = (turns.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const sheet = await loadHighlights(path)
      const held = frozen(sheet)
      if (held) return held
      const next = change(sheet)
      await invoke('write_highlights', { path, content: writeSheet(next) })
      return next
    })
  turns.set(path, turn)
  void turn
    .catch(() => undefined)
    .finally(() => {
      if (turns.get(path) === turn) turns.delete(path)
    })
  return turn
}
