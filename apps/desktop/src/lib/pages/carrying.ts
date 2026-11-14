import { account } from '../accounts/src/api'
import { api } from '../accounts/src/api'
import { fileBytes, sha256 } from '../bytes'
import { rootedAt } from '../space-paths'
import { keepJson, recordOf, stored, isString } from '../stored'
import { invoke, isNative, joinPath } from '../tauri'
import { isPagesTarget } from '@orden/markdown/links'
import type { Mirror } from '../sync/mirror'
import { workspace } from '../workspace.svelte'
import { type Carried, type Carrying, carryPapers, forgetLacking, paperFor } from './carried'

const EVERY = 3000

const KEY = 'orden:papers-carried:'

let carrying: Promise<void> | null = null
let lastAt = 0
let lastToken: string | null = null

let record: { whose: string; carried: Map<string, string> } | null = null

function carriedFor(whose: string): Map<string, string> {
  if (record?.whose !== whose) {
    const held = recordOf(stored(KEY + whose), isString)
    record = { whose, carried: new Map(Object.entries(held)) }
  }
  return record.carried
}

function how(token: string, whose: string, said: Carrying['said'] = () => undefined): Carrying {
  const carried = carriedFor(whose)
  return {
    exists: onDisk,
    async stamp(path) {
      const stamp = await invoke<unknown>('file_stamp', { path }).catch(() => null)
      return stamp === null || stamp === undefined ? null : JSON.stringify(stamp)
    },
    async read(path) {
      return await fileBytes(path).catch(() => null)
    },
    async write(path, bytes) {
      await invoke('write_bytes', { path, bytes })
    },
    text: (path) => invoke<string>('read_note', { path }).catch(() => null),
    hash: (bytes) => sha256(bytes),
    async up(hash, bytes) {
      await api.putBlob(token, hash, 'application/pdf', bytes.slice().buffer)
    },
    async hold(id, hash) {
      await api.holdPaper(token, id, hash)
    },
    down: (id) => api.notePaper(token, id),
    carried,
    kept: () => void keepJson(KEY + whose, Object.fromEntries(carried)),
    said,
  }
}

async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    const stamp = await invoke<unknown>('file_stamp', { path }).catch(() => null)
    return stamp !== null && stamp !== undefined
  }
  return await invoke<unknown>('read_asset', { path }).then(
    (held) => typeof held === 'string',
    () => false,
  )
}

export function mirroredPages(
  mirrors: readonly Mirror[],
  reads: (spaceId: string) => boolean,
): Carried[] {
  const out: Carried[] = []
  for (const mirror of mirrors) {
    const space = rootedAt(workspace.spaces, mirror.root)
    if (!space) continue
    const writes = !reads(mirror.spaceId)
    for (const [path, held] of Object.entries(mirror.notes)) {
      if (isPagesTarget(path)) {
        out.push({ path: joinPath(mirror.root, path), id: held.id, writes, space: space.name })
      }
    }
  }
  return out
}

export function carryNow(notes: () => Carried[], said: Carrying['said']): Promise<void> {
  const token = account.token
  const whose = account.user?.id
  if (!token || !whose || carrying || Date.now() - lastAt < EVERY) return Promise.resolve()

  lastAt = Date.now()
  if (token !== lastToken) forgetLacking()
  lastToken = token
  carrying = carryPapers(notes(), how(token, whose, said)).finally(() => (carrying = null))
  return carrying
}

export async function paperFromAccount(
  id: string,
  note: string | null,
): Promise<Uint8Array | null> {
  const token = account.token
  if (!token) return null
  return await paperFor(id, note, how(token, account.user?.id ?? 'guest'))
}
