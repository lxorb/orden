import { decodeTarget } from '@orden/markdown/links'
import { assetUrl, imagePath, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

function fileNamed(src: string, notePath: string | null): string | null {
  const read = decodeTarget(src)
  return links.fileFor(src, notePath) ?? (read === src ? null : links.fileFor(read, notePath))
}

export function picturePath(src: string, notePath: string | null, source: string): string | null {
  const beside = imagePath(src, notePath, source)
  if (beside === null || links.holdsFile(beside)) return beside
  return fileNamed(src, notePath)
}

export function notePicture(src: string, notePath: string | null, source: string): string {
  const found = picturePath(src, notePath, source)
  return found ? assetUrl(found) : imageUrl(src, notePath, source)
}
