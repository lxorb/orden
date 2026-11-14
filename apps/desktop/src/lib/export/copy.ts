import { fileBytes, mimeOfPath, UNKNOWN_TYPE } from '../platform/src/api'
import { deliver } from './save'

export function extensionOf(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? 'bin'
}

export function mimeOf(path: string): string {
  return mimeOfPath(path) ?? UNKNOWN_TYPE
}

export async function saveCopy(path: string, name: string): Promise<string | null> {
  const extension = extensionOf(path)

  return deliver(name, extension, extension.toUpperCase(), {
    bytes: await fileBytes(path),
    mime: mimeOf(path),
  })
}
