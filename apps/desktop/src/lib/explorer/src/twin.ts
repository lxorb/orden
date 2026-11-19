import { isRecord, isString } from '../../platform/src/api'

export const terminalWords = (folder: string | null): string => JSON.stringify({ folder })
export function folderIn(words: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(words)
  } catch {
    return null
  }
  return isRecord(value) && isString(value.folder) && value.folder ? value.folder : null
}
