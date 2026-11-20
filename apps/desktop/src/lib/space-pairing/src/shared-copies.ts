import type { SyncPairing } from '@orden/contracts'
import { account, api } from '../../accounts/src/api'
import {
  fileBytes,
  invoke,
  isRecord,
  joinPath,
  keepJson,
  samePath,
  stored,
  stringList,
  within,
} from '../../platform/src/api'
import { endSpace } from '../../space-owed/src/api'
import { type Entry, workspace } from '../../workspace/src/api'

const MENDED = 'orden:shared-copies-mended'
const MOST = 200
interface Pair {
  readonly root: string
  readonly spaceId: string
}
function mendedBy(who: string): string[] {
  const saved = stored(MENDED)
  return (isRecord(saved) ? stringList(saved[who]) : null) ?? []
}
function mended(who: string, spaceId: string) {
  const saved = stored(MENDED)
  const all = isRecord(saved) ? saved : {}
  const ids = mendedBy(who).filter((one) => one !== spaceId)
  keepJson(MENDED, { ...all, [who]: [...ids, spaceId].slice(-MOST) })
}
function copyName(name: string, of: string): boolean {
  if (name === of) return true
  const rest = name.slice(of.length)
  return name.startsWith(of) && /^ (?:[2-9]|[1-9]\d+)$/.test(rest)
}
function filesIn(entry: Entry): Entry[] {
  return entry.is_dir ? entry.children.flatMap(filesIn) : [entry]
}
async function sameBytes(one: string, other: string): Promise<boolean> {
  const [a, b] = await Promise.all([fileBytes(one), fileBytes(other)])
  if (a.length !== b.length) return false
  for (let at = 0; at < a.length; at += 1) if (a[at] !== b[at]) return false
  return true
}
type Heard = (path: string) => Promise<string | null>
async function listing(token: string, spaceId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let since = 0, more = true; more;) {
    const page = await api.changes(token, spaceId, since)
    for (const note of page.notes) {
      if (note.deleted) out.delete(note.path)
      else out.set(note.path, note.hash)
    }
    more = page.more && page.cursor > since
    since = page.cursor
  }
  return out
}
function heard(token: string, spaceId: string): Heard {
  let held: Promise<Map<string, string>> | null = null
  return async (path) => {
    held ??= listing(token, spaceId)
    return (await held).get(path) ?? null
  }
}
async function twinned(
  file: Entry,
  copy: Heard,
  original: Heard,
  away: boolean,
  inside: string,
  twin: string,
): Promise<boolean> {
  if (file.evicted || away) {
    if (!file.evicted || !away) return false
    const one = await copy(inside)
    return !!one && one === (await original(inside))
  }
  return await sameBytes(file.path, twin).catch(() => false)
}
async function mendCopy(
  token: string,
  who: string,
  pairing: SyncPairing,
  original: Pair,
  copy: Pair,
  notes: number,
  theirs: number,
): Promise<boolean> {
  const space = workspace.spaces.find((one) => samePath(one.root, copy.root))
  if (!space) return false
  const files = filesIn(await invoke<Entry>('read_tree', { root: copy.root }))
  if (notes > files.length) return false
  const held = filesIn(await invoke<Entry>('read_tree', { root: original.root }))
  if (theirs > held.length) return false
  const mine = heard(token, copy.spaceId)
  const shared = heard(token, original.spaceId)
  const twins: Entry[] = []
  for (const file of files) {
    const inside = within(copy.root, file.path)
    if (!inside) continue
    const twin = joinPath(original.root, inside)
    const away = held.some((one) => one.evicted && samePath(one.path, twin))
    if (await twinned(file, mine, shared, away, inside, twin)) twins.push(file)
  }
  if (twins.length === files.length) {
    await workspace.deleteSpace(space.id, true)
    if (workspace.spaces.some((one) => samePath(one.root, copy.root))) return false
    pairing.unpair(copy.root)
    await endSpace(token, who, copy.spaceId, 'delete')
    return true
  }
  for (const file of twins) {
    const kept = await workspace.bin(file.path, false)
    await workspace.fileGone(file.path, 'file', kept?.trashId ?? kept?.back)
  }
  return true
}
export async function mendSharedCopies(
  token: string,
  who: string,
  pairing: SyncPairing,
  before: readonly Pair[],
): Promise<void> {
  const pairs = pairing
    .pairs()
    .filter((one) => before.some((was) => was.spaceId === one.spaceId && samePath(was.root, one.root)))
  const listed = (id: string) => account.spaces.find((one) => one.id === id)
  const named = (root: string) => workspace.spaces.find((one) => samePath(one.root, root))?.name
  for (const original of pairs) {
    const theirs = listed(original.spaceId)
    if (!theirs || theirs.role === 'owner' || named(original.root) === undefined) continue
    for (const copy of pairs) {
      const mine = listed(copy.spaceId)
      const folder = named(copy.root)
      if (!mine || folder === undefined) continue
      if (copy.spaceId === original.spaceId || samePath(copy.root, original.root)) continue
      if (mine.role !== 'owner' || mine.shared || mine.onceShared) continue
      if (mine.createdAt <= theirs.createdAt) continue
      if (!copyName(mine.name, theirs.name) || !copyName(folder, theirs.name)) continue
      if (mendedBy(who).includes(copy.spaceId)) continue
      if (await mendCopy(token, who, pairing, original, copy, mine.notes, theirs.notes)) {
        mended(who, copy.spaceId)
      }
    }
  }
}
