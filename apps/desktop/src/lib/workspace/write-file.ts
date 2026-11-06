import { links } from '../link-index.svelte'
import { invoke } from '../tauri'
import { writeTaking } from './in-turn'

export async function writeFile(path: string, content: string): Promise<void> {
  await writeTaking(path, content)
  links.noteSaved(path, content)
}

export async function writeBytes(path: string, base64: string): Promise<void> {
  await invoke('write_bytes', { path, base64 })
  await links.cameBack(path, false)
}

export async function copyPath(from: string, to: string): Promise<void> {
  await invoke('copy_path', { from, to })
}
