import { Channel, invoke } from './native'

export interface Listed {
  path: string
  dir: boolean
  size: number
  mtime: number
  id: string | null
  unlisted?: true
}

export type SpaceChange =
  | ({ kind: 'created' | 'modified' } & Listed)
  | { kind: 'removed'; path: string; dir: boolean; id: string | null }
  | ({ kind: 'renamed'; from: string } & Listed)

export interface SpaceNews {
  root: string
  changes: SpaceChange[]
  scan: boolean
  gone: boolean
  unwatched?: 'folders' | 'limit'
}

export function watchSpaces(
  roots: readonly string[],
  heard: (news: SpaceNews) => void,
): Promise<void> {
  const news = new Channel<unknown>()
  news.onmessage = (message) => {
    const checked = newsOf(message)
    if (checked) heard(checked)
    else console.error('the space watcher said something odd', message)
  }
  return invoke('space_watch', { roots, news })
}

export function unwatchSpaces(): Promise<void> {
  return invoke('space_unwatch').then(() => {
    for (const listener of letGo) listener()
  })
}

const letGo = new Set<() => void>()

export function onUnwatched(listener: () => void): () => void {
  letGo.add(listener)
  return () => letGo.delete(listener)
}

export function scanSpace(root: string, each?: (chunk: Listed[]) => void): Promise<Listed[]> {
  return scanned('space_scan', root, each)
}

function scanned(
  command: string,
  root: string,
  each?: (chunk: Listed[]) => void,
): Promise<Listed[]> {
  return new Promise((resolve, reject) => {
    const all: Listed[] = []
    const listing = new Channel<unknown>()
    listing.onmessage = (message) => {
      const chunk = listingOf(message)
      if (!chunk) {
        reject(new Error('the space listing said something odd'))
        return
      }
      all.push(...chunk.listed)
      each?.(chunk.listed)
      if (chunk.done) resolve(all)
    }
    invoke(command, { root, listing }).catch(reject)
  })
}

export function watchWorking(root: string, heard: (news: SpaceNews) => void): Promise<void> {
  const news = new Channel<unknown>()
  news.onmessage = (message) => {
    const checked = newsOf(message)
    if (checked) heard(checked)
  }
  return invoke('working_watch', { root, news })
}

export function unwatchWorking(root: string): Promise<void> {
  return invoke('working_unwatch', { root })
}

export function scanWorking(root: string): Promise<Listed[]> {
  return scanned('working_scan', root)
}

export async function fileIdentity(path: string): Promise<string | null> {
  const id: unknown = await invoke('file_identity', { path })
  return typeof id === 'string' ? id : null
}

type Loose = Record<string, unknown>

const record = (value: unknown): value is Loose => typeof value === 'object' && value !== null

const whole = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

const identity = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

function listedOf(value: unknown): Listed | null {
  if (!record(value)) return null
  const { path, dir, size, mtime, id } = value
  if (typeof path !== 'string' || typeof dir !== 'boolean' || !whole(size) || !whole(mtime)) {
    return null
  }
  if (!identity(id)) return null
  return { path, dir, size, mtime, id, ...(value.unlisted === true ? { unlisted: true } : {}) }
}

function changeOf(value: unknown): SpaceChange | null {
  if (!record(value)) return null
  switch (value.kind) {
    case 'created':
    case 'modified': {
      const listed = listedOf(value)
      return listed && { kind: value.kind, ...listed }
    }
    case 'renamed': {
      const listed = listedOf(value)
      return listed && typeof value.from === 'string'
        ? { kind: 'renamed', from: value.from, ...listed }
        : null
    }
    case 'removed': {
      const { path, dir, id } = value
      return typeof path === 'string' && typeof dir === 'boolean' && identity(id)
        ? { kind: 'removed', path, dir, id }
        : null
    }
    default:
      return null
  }
}

export function newsOf(value: unknown): SpaceNews | null {
  if (!record(value)) return null
  const { root, changes, scan, gone, unwatched } = value
  if (typeof root !== 'string' || !Array.isArray(changes)) return null
  if (typeof scan !== 'boolean' || typeof gone !== 'boolean') return null
  const checked = changes.map(changeOf)
  if (checked.some((one) => one === null)) return null
  const news: SpaceNews = { root, changes: checked as SpaceChange[], scan, gone }
  if (unwatched === 'folders' || unwatched === 'limit') news.unwatched = unwatched
  return news
}

export function listingOf(value: unknown): { listed: Listed[]; done: boolean } | null {
  if (!record(value) || !Array.isArray(value.listed) || typeof value.done !== 'boolean') {
    return null
  }
  const listed = value.listed.map(listedOf)
  if (listed.some((one) => one === null)) return null
  return { listed: listed as Listed[], done: value.done }
}
