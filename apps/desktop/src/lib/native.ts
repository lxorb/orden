import { invoke as handedOn, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core'

export { Channel } from '@tauri-apps/api/core'

const PATH_HEADER = 'Orden-Path'

export function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (command === 'write_bytes' && args && !Array.isArray(args) && !ArrayBuffer.isView(args)) {
    const { path, bytes } = args as Record<string, unknown>
    if (typeof path === 'string' && bytes instanceof Uint8Array) {
      return handedOn<T>(command, bytes, { headers: { [PATH_HEADER]: encodeURIComponent(path) } })
    }
  }
  return handedOn<T>(command, args, options)
}
