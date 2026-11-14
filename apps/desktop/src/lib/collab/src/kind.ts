import { isCanvasTarget, isPagesTarget, isWebTarget } from '@orden/markdown/links'

export type RoomKind = 'words' | 'plane'

export function roomKind(path: string | null | undefined): RoomKind | null {
  const name = path ?? ''
  if (isWebTarget(name)) return null
  return isCanvasTarget(name) || isPagesTarget(name) ? 'plane' : 'words'
}

export function roomKindOf(note: { path: string | null; shared: string | null; kind: string }) {
  if (note.path !== null || !note.shared) return roomKind(note.path)
  return note.kind === 'canvas' || note.kind === 'pages' ? 'plane' : 'words'
}
