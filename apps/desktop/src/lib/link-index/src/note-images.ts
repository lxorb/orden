import { decodeTarget } from '@orden/markdown/links'
import { assetUrl, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const name = decodeTarget(src)
  const found = links.fileFor(name, notePath)

  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
