import { invoke } from '../tauri'
import { writeTaking } from '../workspace/in-turn'

export class NotWritten extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

export async function writeDown(path: string, content: string, was?: string | null) {
  const previous =
    was === undefined ? await invoke<string>('read_note', { path }).catch(() => null) : was

  if (previous !== null && previous !== content && previous.trim()) {
    await invoke('snapshot_note', { path, content: previous }).catch(() => undefined)
  }

  await writeTaking(path, content, true).catch((error: unknown) => {
    throw new NotWritten(path, error)
  })
}
