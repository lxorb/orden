import { isWebAddress } from '../web-tab/address'

const LIST = 'text/uri-list'
const PLAIN = 'text/plain'

export function droppedAddress(read: (type: string) => string): string | null {
  const listed = read(LIST)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))

  for (const one of [listed, read(PLAIN).trim()]) {
    if (one && isWebAddress(one)) return one
  }

  return null
}
