import { assetUrl, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const found = links.fileFor(src, notePath)

  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
