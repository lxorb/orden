/** The app's half of carrying a page note's paper (carried.ts): the disk, the account
 *  and the record of what has gone up, for both syncs and for a page that opens.
 *
 *  Fetched by the first pass and the first paper that is not on this device, and not
 *  before: nothing in it is needed to draw a note. */

import { account } from '../account.svelte'
import { api } from '../api'
import { fileBytes, sha256, toBase64 } from '../bytes'
import { keepJson, recordOf, stored, isString } from '../stored'
import { invoke, isNative, joinPath } from '../tauri'
import { isPagesTarget } from '@orden/markdown/links'
import type { Mirror } from '../sync/mirror'
import { workspace } from '../workspace.svelte'
import { type Carried, type Carrying, carryPapers, forgetLacking, paperFor } from './carried'

/** The least time between two carryings. Each page note is looked at once a session
 *  (carried.ts), so a carrying after the first costs a walk of the list; this only
 *  keeps a run of passes from walking it on every one. */
const EVERY = 3000

const KEY = 'nib:papers-carried:'

let carrying: Promise<void> | null = null
let lastAt = 0
/** The session the last carrying ran under; a new one starts over. */
let lastToken: string | null = null

/** What has been carried, by the account signed in now. */
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
      await invoke('write_bytes', { path, base64: toBase64(bytes) })
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

/** Whether a file is at this path on the disk; see `onDisk` in turning.ts. */
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

/** The page notes v1's mirrors hold, for their papers: of the spaces the workspace
 *  lists, as a pass syncs them, each named as v1's log names a space. `reads` says which
 *  are shared to read. */
export function mirroredPages(
  mirrors: readonly Mirror[],
  reads: (spaceId: string) => boolean,
): Carried[] {
  const out: Carried[] = []
  for (const mirror of mirrors) {
    const space = workspace.spaces.find((one) => one.root === mirror.root)
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

/** Every page note the account holds here, carried, at most once in a while. Answers
 *  at once where a carrying is under way or one was moments ago. `said` takes a line for
 *  the log of the sync asking. */
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

/** The paper of a page note this device does not have, from the account; see
 *  `paperFor` in carried.ts. A guest asks with the session a link gave them. */
export async function paperFromAccount(
  id: string,
  note: string | null,
): Promise<Uint8Array | null> {
  const token = account.token
  if (!token) return null
  return await paperFor(id, note, how(token, account.user?.id ?? 'guest'))
}
