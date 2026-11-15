import { isAudioTarget, isImageTarget, isVideoTarget } from '@orden/markdown/links'
import { about } from './complete'
import { type LinkWrite, type NoteIndex, resolveFile } from './notes'

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
  const said = file ? fileNameFor(index, path) : name.replace(/\.[^.]+$/, '')
  const link = write({ name: said, path, from: index.path })
  const shown = isImageTarget(path) || isAudioTarget(path) || isVideoTarget(path)

  return file && shown ? `!${link}` : link
}

function fileNameFor(index: NoteIndex, path: string): string {
  const parts = path.split('/')
  for (let from = parts.length - 1; from >= 0; from--) {
    const written = parts.slice(from).join('/')
    if (resolveFile(index, written, 'wikilink') === path) return written
  }
  return `/${path}`
}
