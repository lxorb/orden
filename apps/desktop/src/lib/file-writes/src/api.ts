import { links } from '../../link-index/src/api'
import { onDisk, invoke, oneWriteAt, writeInTurn, writeTaking } from '../../platform/src/api'
import { wroteHere } from '../../documents/src/api'

export interface Hearing {
  there(path: string): Promise<boolean>
  made(path: string): Promise<void>
  wrote(path: string, content: string): void
}
let hearing: Hearing | null = null
export function hearWrites(one: Hearing): () => void {
  hearing = one
  return () => {
    if (hearing === one) hearing = null
  }
}
export async function writeBy(path: string, content: string | null, write: () => Promise<unknown>): Promise<void> {
  const ear = hearing
  const was = ear ? await ear.there(path) : true
  await write()
  if (!ear) return
  if (!was) await ear.made(path)
  else if (content !== null) ear.wrote(path, content)
}
export async function writeFile(path: string, content: string): Promise<void> {
  await writeBy(path, content, async () => {
    await writeTaking(path, content)
    links.noteSaved(path, content)
  })
  wroteHere(path)
}
export async function writeIfAbsent(path: string, content: string): Promise<boolean> {
  const made = await oneWriteAt(path, async () => {
    if (await onDisk(path)) return false
    await writeInTurn(path, content)
    return true
  })
  if (!made) return false
  links.noteSaved(path, content)
  await hearing?.made(path)
  wroteHere(path)
  return true
}
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await writeBy(path, null, async () => {
    await invoke('write_bytes', { path, bytes })
    await links.cameBack(path, false)
  })
}
function besideNote(notePath: string, relative: string): string {
  const parts = notePath.split(/[/\\]/).slice(0, -1)
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join(notePath.includes('\\') ? '\\' : '/')
}
export async function saveAsset(notePath: string, folder: string, name: string, bytes: Uint8Array): Promise<string> {
  const relative = await invoke<string>('save_asset', { notePath, folder, name, bytes })
  await hearing?.made(besideNote(notePath, relative))
  return relative
}
export async function copyPath(from: string, to: string): Promise<void> {
  await invoke('copy_path', { from, to })
}
