import { imageUrl } from './platform/src/api'
import { links } from './link-index/src/api'
import { assetUrl } from './platform/src/api'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const found = !src.includes('/') ? links.fileFor(src, notePath) : null

  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
