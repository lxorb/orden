import { needPort, type SyncNote, type SyncWorkspacePort } from '@orden/contracts'
import type { SharedDoc } from '@orden/editor'

export interface LiveNote extends SyncNote {
  readonly live: SharedDoc
}

const host = () => needPort('sync.host')

const storage = () => needPort('sync.storage')

const clock = () => needPort('sync.clock')

export const account = () => needPort('sync.account')

export const remote = () => needPort('sync.api')

export const workspace = () => needPort('sync.workspace') as SyncWorkspacePort<LiveNote>

export const isNative = () => host().isNative

export const isDesktop = () => host().isDesktop

export const platform = () => host().platform()

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return host().invoke<T>(command, args)
}

export const joinPath = (dir: string, relative: string) => host().joinPath(dir, relative)

export const stored = (key: string) => storage().json(key)

export const storedText = (key: string) => storage().text(key)

export const keepText = (key: string, value: string) => storage().keepText(key, value)

export const keepJson = (key: string, value: unknown) => storage().keepJson(key, value)

export const forget = (key: string) => storage().forget(key)

export const waited = (ms?: number) => clock().waited(ms)
