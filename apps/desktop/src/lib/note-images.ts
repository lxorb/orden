import { imageUrl } from './images'
import { links } from './link-index.svelte'
import { assetUrl } from './tauri'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const found = !src.includes('/') ? links.fileFor(src, notePath) : null

  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
