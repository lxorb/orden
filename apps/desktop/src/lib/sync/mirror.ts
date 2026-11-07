import { isNumber, isRecord, isString } from '../stored'
import { invoke } from '../tauri'

export interface Tracked {
  id: string
  version: number
  hash: string
}

export interface TrackedFile {
  hash: string
  modified: number
}

export interface Mirror {
  spaceId: string
  root: string
  cursor: number
  notes: Record<string, Tracked>
  offered: Record<string, string>
  files: Record<string, TrackedFile>
  dropped: boolean
  shared: boolean
  moving?: Moving
  untold?: Record<string, Untold>
}

export interface Moving {
  id: string
  from: string
  to: string
}

export interface Untold {
  from: string
  to: string
  tries: number
  failing?: { since: number; times: number }
}

export function newMirror(spaceId: string, root: string, shared = false): Mirror {
  return { spaceId, root, cursor: 0, notes: {}, offered: {}, files: {}, dropped: false, shared }
}

export function within(root: string, path: string): string | null {
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = path.replace(/\\/g, '/')

  if (!file.startsWith(`${folder}/`)) return null
  return file.slice(folder.length + 1)
}

export interface Stamp {
  modified: number
  len: number
}

export async function fileStamp(path: string): Promise<Stamp | null> {
  const found: unknown = await invoke('file_stamp', { path }).catch(() => null)
  return isRecord(found) && isNumber(found.modified) && isNumber(found.len)
    ? { modified: found.modified, len: found.len }
    : null
}

export const MIRRORS_KEY = 'orden:mirrors'

export interface Saved {
  whose: string | null
  seen: boolean
  mirrors: Record<string, Mirror>
}

export function savedRecord(saved: unknown): Saved | null {
  if (!isRecord(saved)) return null

  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  const mirrors: Record<string, Mirror> = {}
  for (const [root, one] of Object.entries(held)) {
    const mirror = readMirror(root, one)
    if (mirror) mirrors[root] = mirror
  }

  return {
    whose: typeof saved.account === 'string' ? saved.account : null,
    seen: saved.seen === true || Object.keys(mirrors).length > 0,
    mirrors,
  }
}

export function readMirror(root: string, value: unknown): Mirror | null {
  if (!isRecord(value) || !isString(value.spaceId)) return null

  return {
    spaceId: value.spaceId,
    root,
    cursor: typeof value.cursor === 'number' ? value.cursor : 0,
    notes: readTracked(value.notes),
    offered: readOffered(value.offered),
    files: readTrackedFiles(value.files),
    dropped: value.dropped === true,
    shared: value.shared === true,
    ...(isRecord(value.moving) &&
    isString(value.moving.id) &&
    isString(value.moving.from) &&
    isString(value.moving.to)
      ? { moving: { id: value.moving.id, from: value.moving.from, to: value.moving.to } }
      : {}),
    ...readUntold(value.untold),
  }
}

function readUntold(value: unknown): { untold?: Record<string, Untold> } {
  if (!isRecord(value)) return {}

  const out: Record<string, Untold> = {}
  for (const [id, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.from) || !isString(one.to)) continue

    const failing =
      isRecord(one.failing) && isNumber(one.failing.since) && isNumber(one.failing.times)
        ? { failing: { since: one.failing.since, times: one.failing.times } }
        : {}
    out[id] = { from: one.from, to: one.to, tries: isNumber(one.tries) ? one.tries : 0, ...failing }
  }

  return Object.keys(out).length ? { untold: out } : {}
}

function readTrackedFiles(value: unknown): Record<string, TrackedFile> {
  if (!isRecord(value)) return {}

  const out: Record<string, TrackedFile> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.hash) || !isNumber(one.modified)) continue

    out[path] = { hash: one.hash, modified: one.modified }
  }

  return out
}

function readOffered(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [path, hash] of Object.entries(value)) {
    if (isString(hash) && hash) out[path] = hash
  }

  return out
}

function readTracked(value: unknown): Record<string, Tracked> {
  if (!isRecord(value)) return {}

  const out: Record<string, Tracked> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.id) || !isString(one.hash)) continue
    if (typeof one.version !== 'number') continue

    out[path] = { id: one.id, version: one.version, hash: one.hash }
  }

  return out
}
