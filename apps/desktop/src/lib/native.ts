import { invoke as handedOn, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core'

export { Channel } from '@tauri-apps/api/core'

const ARGS_HEADER = 'Orden-Args'

const RAW = new Set(['write_bytes', 'save_asset'])

export function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (RAW.has(command) && args && !Array.isArray(args) && !ArrayBuffer.isView(args)) {
    const { bytes, ...rest } = args as Record<string, unknown>
    if (bytes instanceof Uint8Array) {
      return handedOn<T>(command, bytes, {
        headers: { [ARGS_HEADER]: encodeURIComponent(JSON.stringify(rest)) },
      })
    }
  }
  return handedOn<T>(command, args, options)
}
