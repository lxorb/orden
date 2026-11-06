import type { Framed } from '@orden/sync-core/wire'
import type { Classify } from './classify'
import type { Blobs } from './files'

export type Route = 'prepare' | 'ops' | 'feed' | 'pull' | 'push' | 'keep'

export type FileKind = 'file' | 'folder'

export interface Disk {
  read(path: string): Promise<string | null>
  write(path: string, text: string): Promise<void>
  keep(path: string, text: string): Promise<void>
  move(from: string, to: string, kind: FileKind): Promise<void>
  remove(path: string, kind: FileKind): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  evicted(path: string): Promise<boolean>
}

export interface Account {
  ask(route: Route, body: Framed, space: string): Promise<unknown>
}

export interface World {
  disk: Disk
  account: Account
  name: string
  now(): number
  random(): number
  digest(text: string): Promise<string>
  join(root: string, path: string): string
  foldsCase: boolean
  platform: 'windows' | 'mac' | 'other'
  list?(root: string): Promise<{ path: string; dir: boolean }[] | null>
  ancestor?(id: string, hash: string): Promise<string | null>
  classify?: Classify
  blobs?: Blobs
  lazy?: boolean
}
