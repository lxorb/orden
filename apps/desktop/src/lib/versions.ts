import { account } from './accounts/src/api'
import { api } from './accounts/src/api'
import { sha256 } from './bytes'
import { sync } from './sync.svelte'
import { invoke } from './tauri'

interface Snapshot {
  taken_at: number
  size: number
  path: string
  source?: string | null
}

export interface Version {
  at: number
  size: number
  path: string | null
  by: string
}

const TOGETHER = 60 * 1000

export async function versionsOf(path: string): Promise<Version[]> {
  const mine = await invoke<Snapshot[]>('list_snapshots', { path }).catch(() => [])
  const here: Version[] = mine.map((one) => ({
    at: one.taken_at,
    size: one.size,
    path: one.path,
    by: one.source ?? '',
  }))

  const token = account.accountToken
  const id = sync.tracked(path)?.id
  if (!token || !id) return here

  const theirs = await api.noteVersions(token, id).catch(() => ({ versions: [] }))
  const hashes = new Map<string, Promise<string[]>>()
  const hashesOf = (copy: string) => {
    let held = hashes.get(copy)
    if (!held) {
      held = invoke<string>('read_snapshot', { path: copy, notePath: path }).then(
        (words) => {
          const lf = words.replace(/\r\n?/g, '\n')
          return Promise.all([sha256(words), sha256(lf), sha256(lf.replace(/\n/g, '\r\n'))])
        },
        () => [],
      )
      hashes.set(copy, held)
    }
    return held
  }

  const kept = await Promise.all(
    theirs.versions.map(async (one) => {
      if (!one.hash) return true
      for (const ours of here) {
        if (Math.abs(ours.at - one.at) >= TOGETHER || ours.path === null) continue
        if ((await hashesOf(ours.path)).includes(one.hash)) return false
      }
      return true
    }),
  )
  const fromAccount = theirs.versions
    .filter((_, index) => kept[index])
    .map((one) => ({ at: one.at, size: one.size, path: null, by: one.by }))

  return [...here, ...fromAccount].sort((one, other) => other.at - one.at)
}

export async function versionText(version: Version, notePath: string): Promise<string> {
  if (version.path !== null) {
    return await invoke<string>('read_snapshot', { path: version.path, notePath })
  }

  const token = account.accountToken
  const id = sync.tracked(notePath)?.id
  if (!token || !id) return ''

  const said = await api.noteVersion(token, id, version.at)
  return said.content
}
