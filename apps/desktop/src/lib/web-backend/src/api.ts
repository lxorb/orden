import type { Found } from '@orden/scan/search/walk'
import type { FuzzyHit } from '@orden/scan/search/fuzzy'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import type { Warmth } from '@orden/scan/search/warmth'
import type { ItemMeta } from '@orden/sync-core'
import type { Twins } from './internal/convert'

interface Space {
  name: string
  path: string
}
interface KeptFolder {
  name: string
  readText(path: string): Promise<string | null>
}
interface WebMeta {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<unknown>
  remove(key: string): Promise<unknown>
}
export const webInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
  (await import('./web/commands')).webInvoke<T>(command, args)
export const seed = async (): Promise<boolean> => (await import('./web/commands')).seed()
export const webMeta = async (): Promise<WebMeta> => (await import('./web/store')).meta
export const databaseName = async (from: string, to: string): Promise<string> =>
  (await import('./web/carry-database')).databaseName(from, to)
export const searchInWorker = async (
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> => {
  await (await import('./web/search-client')).searchInWorker(root, query, terms, limit, onFound, excluded)
}
export const warmSpace = async (root: string, heard: (warmth: Warmth) => void): Promise<void> => {
  ;(await import('./web/search-client')).warmSpace(root, heard)
}
export const internalInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
  (await import('./internal/route')).internalInvoke<T>(command, args)
export const keptMounts = () => import('./internal/watch')
export const listedWith = async (folders: readonly Space[]): Promise<Space[]> =>
  (await import('./internal/spaces')).listedWith(folders)
export const keptCameFrom = async (): Promise<{ root: string; from: string }[]> =>
  (await import('./internal/spaces')).keptCameFrom()
export const keptFolder = async (root: string): Promise<KeptFolder | null> =>
  (await import('./internal/spaces')).keptFolder(root)
export const convertAll = async (ws: Twins): Promise<void> => {
  await (await import('./internal/convert')).convertAll(ws)
}
export const keepWorking = async (): Promise<void> => {
  await (await import('./internal/work')).keepWorking()
}
export const diskPathOf = async (path: string): Promise<string> => (await import('./internal/work')).diskPathOf(path)
export const workingPath = async (path: string): Promise<string | null> =>
  (await import('./internal/work')).workingPath(path)
export const workingFolder = async (path: string): Promise<string | null> =>
  (await import('./internal/work')).workingFolder(path)
export const searchInternal = async (
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: { hits: Hit[]; loose: FuzzyHit[] }) => void,
  excluded: readonly string[],
): Promise<boolean> => (await import('./internal/search')).searchInternal(root, query, terms, limit, onFound, excluded)
export const warmInternal = async (root: string): Promise<Warmth | null> =>
  (await import('./internal/search')).warmInternal(root)
export const exportSpace = async (
  root: string,
  name: string,
  metaOf: (path: string) => ItemMeta | null = () => null,
): Promise<string | null> => (await import('./internal/export')).exportSpace(root, name, metaOf)
export const ownKeys = () => import('./own-keys')
