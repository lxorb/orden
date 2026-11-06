import { api } from '../api'
import { sha256 } from '../bytes'
import { invoke } from '../tauri'

const AT_ONCE = 100

const LOOKED_AT = 12

export function unixLines(text: string): string {
  return text.replace(/\r\n/gu, '\n')
}

export async function behind(
  token: string,
  copies: readonly { id: string; hash: string }[],
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let at = 0; at < copies.length; at += AT_ONCE) {
    const asked = await api.said(token, copies.slice(at, at + AT_ONCE)).catch(() => ({ said: [] }))
    for (const id of asked.said) found.add(id)
  }
  return found
}

interface Snapshot {
  path: string
}

export async function baseOf(
  token: string,
  path: string,
  id: string,
  hash: string,
): Promise<string | null> {
  if (!hash) return null

  const kept = await invoke<Snapshot[]>('list_snapshots', { path }).catch(() => [])
  for (const one of kept.slice(0, LOOKED_AT)) {
    const text = await invoke<string>('read_snapshot', { path: one.path, notePath: path }).catch(
      () => null,
    )
    if (text !== null && (await sha256(text)) === hash) return text
  }

  const held = await api.saidAs(token, id, hash).catch(() => null)
  return held?.content ?? null
}
