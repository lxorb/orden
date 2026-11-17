import { assetUrl, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const found = !src.includes('/') ? links.fileFor(src, notePath) : null

  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
