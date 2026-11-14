import { type ImageKind, MOST_IMAGE } from '@orden/online/wire'
import { busy } from '../busy.svelte'
import { fileBytes } from '../platform/src/api'
import { imageKindAt, imageKindOf, spokenPaths } from './paste'
import type { Source } from './source'

export interface Picture {
  kind: ImageKind
  bytes: () => Promise<Uint8Array>
}

export function pictureOf(blob: Blob): Picture | null {
  const kind = imageKindOf(blob.type)
  return kind && { kind, bytes: async () => new Uint8Array(await blob.arrayBuffer()) }
}

export function pictureAt(path: string): Picture | null {
  const kind = imageKindAt(path)
  return kind && { kind, bytes: () => fileBytes(path) }
}

export async function clipboardPicture(): Promise<Picture | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((one) => imageKindOf(one) !== null)
      if (type) return pictureOf(await item.getType(type))
    }
  } catch {
    // Refused, or nothing there that reads: no picture.
  }
  return null
}

export async function carried(
  source: Source,
  pictures: Picture[],
  shell: string,
): Promise<string | null> {
  const image = source.image?.bind(source)
  if (!image || !pictures.length) return null

  try {
    const paths = await busy.run('Sending the image', async () => {
      const paths: string[] = []
      for (const picture of pictures) {
        const bytes = await picture.bytes()
        if (bytes.length > MOST_IMAGE) throw new Error('larger than a paste carries')
        paths.push(await image(bytes, picture.kind))
      }
      return paths
    })
    const { said, left } = spokenPaths(paths, shell)
    if (left) busy.failed('A name this shell would misread was left out')
    return said || null
  } catch {
    busy.failed('Could not send the image')
    return null
  }
}
