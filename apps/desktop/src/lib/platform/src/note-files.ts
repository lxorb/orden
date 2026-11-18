import { invoke } from './tauri'
import { oneWriteAt, windows } from './windows'

export const readText = (path: string): Promise<string | null> =>
  invoke<string>('read_note', { path }).catch(() => null)

export async function keepVersion(path: string, content: string, source?: string): Promise<void> {
  const from = source === undefined ? {} : { source }
  await invoke('snapshot_note', { path, content, ...from }).catch(() => undefined)
}

export async function writeInTurn(path: string, content: string, arrived = false): Promise<void> {
  await invoke('write_note', arrived ? { path, content, arrived } : { path, content })
  if (!windows.alone) windows.say('words', { path, text: content })
}

export const writeTaking = (path: string, content: string, arrived = false): Promise<void> =>
  oneWriteAt(path, () => writeInTurn(path, content, arrived))
