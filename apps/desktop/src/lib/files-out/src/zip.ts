export interface Entry {
  path: string
  body: string | Uint8Array
  stored?: boolean
}

const PACKED = /\.(png|jpe?g|gif|webp|avif|pdf|zip|epub|mp3|mp4|m4a|ogg|webm|woff2?)$/i

export async function zipOf(entries: readonly Entry[]): Promise<Uint8Array> {
  if (__EVEN_PLUGIN__) throw new Error('no zip in the Even Realities plugin')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  for (const entry of entries) {
    zip.file(
      entry.path,
      entry.body,
      (entry.stored ?? PACKED.test(entry.path)) ? { compression: 'STORE' } : {},
    )
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
