import { decodeTarget } from '@orden/markdown/links'
import { assetUrl, imagePath, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

function fileNamed(src: string, notePath: string | null): string | null {
  const read = decodeTarget(src)
  return links.fileFor(src, notePath) ?? (read === src ? null : links.fileFor(read, notePath))
}

export function notePicture(src: string, notePath: string | null, source: string): string {
  const bare = !src.includes('/')
  const found = bare ? fileNamed(src, notePath) : null
  if (found) return assetUrl(found)

  const beside = bare ? null : imagePath(src, notePath, source)
  const anywhere = beside && !links.holdsFile(beside) ? fileNamed(src, notePath) : null
  if (anywhere) return assetUrl(anywhere)

  return imageUrl(src, notePath, source)
}
