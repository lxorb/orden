import { invoke } from '../tauri'
import type { OutsideTicket } from '../workspace/undo.svelte'
import { moved } from './follow'

export interface Entry {
  name: string
  kind: 'file' | 'folder' | 'link'
  folder: boolean
  size: number
  modified: number
  created: number
  hidden: boolean
}

export interface Listing {
  path: string
  parent: string | null
  entries: Entry[]
  own: boolean
  spaces: boolean
  cut: boolean
}

export type PlaceKind =
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'
  | 'spaces'
  | 'root'
  | 'disk'

export interface Place {
  kind: PlaceKind
  path: string
  name: string | null
}

export function listFolder(path: string): Promise<Listing> {
  return invoke<Listing>('explorer_list', { path })
}

export function listPlaces(): Promise<Place[]> {
  return invoke<Place[]>('explorer_places')
}

export function openWithSystem(path: string): Promise<void> {
  return invoke<undefined>('explorer_open', { path })
}

const watchTurns = new Map<string, Promise<void>>()

function inTurn(folder: string, command: string): Promise<void> {
  const before = watchTurns.get(folder) ?? Promise.resolve()
  const turn = before.then(() => invoke<undefined>(command, { folder }))
  const settled = turn.then(
    () => undefined,
    () => undefined,
  )
  watchTurns.set(folder, settled)
  void settled.then(() => {
    if (watchTurns.get(folder) === settled) watchTurns.delete(folder)
  })
  return turn
}

export function watchFolder(folder: string): Promise<void> {
  return inTurn(folder, 'explorer_watch')
}

export function unwatchFolder(folder: string): Promise<void> {
  return inTurn(folder, 'explorer_unwatch')
}

export const CHANGED = 'explorer://changed'

export interface Pair {
  from: string
  to: string
}

export interface Transferred {
  done: (Pair & { stayed?: boolean })[]
  replaced: OutsideTicket[]
  skipped: string[]
  failed: { path: string; why: string }[]
  cancelled: boolean
}

export type Clash = 'replace' | 'skip' | 'keep'

export function makeIn(folder: string, name: string, file: boolean): Promise<string> {
  return invoke<string>('explorer_make', { folder, name, file })
}

export async function renameTo(path: string, name: string): Promise<string> {
  const to = await invoke<string>('explorer_rename', { path, name })
  moved(path, to)
  return to
}

function carried(done: Transferred, how: 'copy' | 'move'): Transferred {
  if (how === 'move') for (const one of done.done) if (!one.stayed) moved(one.from, one.to)
  return done
}

export interface Trashing {
  why: string
  went: OutsideTicket[]
}

export function trashPaths(paths: readonly string[]): Promise<OutsideTicket[]> {
  return invoke<OutsideTicket[]>('explorer_trash', { paths })
}

export function untrash(tickets: readonly OutsideTicket[]): Promise<string[]> {
  return invoke<string[]>('explorer_untrash', { tickets })
}

export function deleteForGood(paths: readonly string[]): Promise<void> {
  return invoke<undefined>('explorer_delete', { paths })
}

export function clashesIn(sources: readonly string[], folder: string): Promise<string[]> {
  return invoke<string[]>('explorer_clashes', { sources, folder })
}

export function transfer(
  job: string,
  sources: readonly string[],
  folder: string,
  how: 'copy' | 'move',
  clash: Clash,
  staying: readonly string[] = [],
): Promise<Transferred> {
  return invoke<Transferred>('explorer_transfer', {
    job,
    sources,
    folder,
    how,
    clash,
    staying,
  }).then((done) => carried(done, how))
}

export function put(
  job: string,
  pairs: readonly Pair[],
  how: 'copy' | 'move',
): Promise<Transferred> {
  return invoke<Transferred>('explorer_put', { job, pairs, how }).then((done) => carried(done, how))
}

export function cancelJob(job: string): Promise<void> {
  return invoke<undefined>('explorer_cancel', { job })
}

export const PROGRESS = 'explorer://progress'

export interface Facts extends Entry {
  path: string
  born: number | null
  accessed: number | null
  readonly: boolean
  mode: string | null
  link: string | null
}

export function factsOf(path: string): Promise<Facts> {
  return invoke<Facts>('explorer_facts', { path })
}

export interface Peek {
  bytes: Uint8Array
  cut: boolean
}

export async function peekAt(path: string, most: number): Promise<Peek> {
  const read = new Uint8Array(await invoke<ArrayBuffer>('explorer_peek', { path, most }))
  return { bytes: read.subarray(0, Math.max(0, read.length - 1)), cut: read.at(-1) === 1 }
}

export interface Count {
  files: number
  folders: number
  bytes: number
  cancelled: boolean
}

export function countIn(job: string, path: string): Promise<Count> {
  return invoke<Count>('explorer_count', { job, path })
}

export interface Found extends Entry {
  within: string
}

export interface Searched {
  found: number
  cut: boolean
  cancelled: boolean
}

export function searchBelow(
  job: string,
  folder: string,
  query: string,
  hidden: boolean,
): Promise<Searched> {
  return invoke<Searched>('explorer_search', { job, folder, query, hidden })
}

export const FOUND = 'explorer://found'
