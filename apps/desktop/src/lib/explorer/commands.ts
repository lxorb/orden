import { invoke } from '../tauri'

export interface Entry {
  name: string
  kind: 'file' | 'folder' | 'link'
  folder: boolean
  size: number
  modified: number
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

export function watchFolder(folder: string): Promise<void> {
  return invoke<undefined>('explorer_watch', { folder })
}

export function unwatchFolder(folder: string): Promise<void> {
  return invoke<undefined>('explorer_unwatch', { folder })
}

export const CHANGED = 'explorer://changed'
