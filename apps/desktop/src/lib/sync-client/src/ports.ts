import {
  portOf,
  type PortMap,
  type PortName,
  type SyncNote,
  type SyncWorkspacePort,
} from '@orden/contracts'
import type { SharedDoc } from '@orden/editor'

export interface LiveNote extends SyncNote {
  readonly live: SharedDoc
}

function need<Name extends PortName>(name: Name): PortMap[Name] {
  const found = portOf(name)
  if (!found.ok) throw new Error(found.error.message)
  return found.value
}

export const host = () => need('sync.host')

export const storage = () => need('sync.storage')

export const clock = () => need('sync.clock')

export const account = () => need('sync.account')

export const remote = () => need('sync.api')

export const workspace = () => need('sync.workspace') as SyncWorkspacePort<LiveNote>

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
