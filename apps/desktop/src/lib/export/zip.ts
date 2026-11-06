export interface Entry {
  path: string
  body: string | Uint8Array
  stored?: boolean
}

export async function zipOf(entries: readonly Entry[]): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  for (const entry of entries) {
    zip.file(entry.path, entry.body, entry.stored ? { compression: 'STORE' } : {})
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
