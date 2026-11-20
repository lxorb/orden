import { endingOf, shownName } from './note-name'

export function shownPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  return path.slice(0, cut) + shownName(path.slice(cut))
}
export function stemOf(name: string): string {
  const ending = endingOf(name)
  const stem = ending === null ? '' : name.slice(0, -ending.length)
  return stem === '' ? name : stem
}
