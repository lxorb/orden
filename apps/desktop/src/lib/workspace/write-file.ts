import { isAccountInbox } from '@orden/bases/inbox'
import { links } from '../link-index.svelte'
import { onDisk } from '../on-disk'
import { invoke } from '../tauri'
import { inFileTurn, writeInTurn, writeTaking, wroteHere } from './in-turn'

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

const earFor = (path: string): Hearing | null => (isAccountInbox(path) ? null : hearing)

export async function writeFile(path: string, content: string): Promise<void> {
  const ear = earFor(path)
  const was = ear ? await ear.there(path) : true
  await writeTaking(path, content)
  links.noteSaved(path, content)
  if (ear) {
    if (was) ear.wrote(path, content)
    else await ear.made(path)
  }
  wroteHere(path)
}

export async function writeIfAbsent(path: string, content: string): Promise<boolean> {
  const ear = earFor(path)
  const made = await inFileTurn(path, async () => {
    if (await onDisk(path)) return false
    await writeInTurn(path, content)
    return true
  })
  if (!made) return false
  links.noteSaved(path, content)
  if (ear) await ear.made(path)
  wroteHere(path)
  return true
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const ear = hearing
  const was = ear ? await ear.there(path) : true
  await invoke('write_bytes', { path, bytes })
  await links.cameBack(path, false)
  if (ear && !was) await ear.made(path)
}

export async function copyPath(from: string, to: string): Promise<void> {
  await invoke('copy_path', { from, to })
}
