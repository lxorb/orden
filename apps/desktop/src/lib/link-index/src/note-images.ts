import { assetUrl, imagePath, imageUrl } from '../../platform/src/api'
import { links } from './links.svelte'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const bare = !src.includes('/')
  const found = bare ? links.fileFor(src, notePath) : null
  if (found) return assetUrl(found)

  const beside = bare ? null : imagePath(src, notePath, source)
  const anywhere = beside && !links.holdsFile(beside) ? links.fileFor(src, notePath) : null
  if (anywhere) return assetUrl(anywhere)

  return imageUrl(src, notePath, source)
}
