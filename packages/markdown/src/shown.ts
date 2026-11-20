import { shownName } from './note-name'

export function shownPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  return path.slice(0, cut) + shownName(path.slice(cut))
}
export const stemOf = (name: string): string => name.replace(/(?<=[^/\\])\.(?=[^./\\\s]*\p{L})[^./\\\s]+$/u, '')
