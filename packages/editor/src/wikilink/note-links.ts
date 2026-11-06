import { isAudioTarget, isImageTarget, isVideoTarget } from '@orden/markdown/links'
import { about } from './complete'
import type { LinkWrite, NoteIndex } from './notes'

export function noteLinks(
  index: NoteIndex,
  paths: readonly string[],
  write: (target: LinkWrite) => string,
): string {
  return paths.map((path) => linkFor(index, path, write)).join('\n')
}

function linkFor(index: NoteIndex, path: string, write: (target: LinkWrite) => string): string {
  const note = index.notes.find((one) => one.path === path)
  if (note) return write(about(index, note))

  const file = index.files.includes(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const link = write({ name: file ? name : name.replace(/\.[^.]+$/, ''), path, from: index.path })
  const shown = isImageTarget(path) || isAudioTarget(path) || isVideoTarget(path)

  return file && shown ? `!${link}` : link
}
