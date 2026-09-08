/** One zip, built the same way for every format that is a package.
 *
 *  A `.textpack`, a `.docx` and an `.epub` are all zips with rules about what is
 *  inside them, and two of the three have a rule about the first entry as well:
 *  an EPUB's `mimetype` has to come first and be stored uncompressed, or a
 *  reader is allowed to refuse the book. So entries keep the order they are
 *  given in, and any one of them may say it is not to be compressed. */

/** One file in a package. Text is encoded UTF-8, which is what every format
 *  here specifies. */
export interface Entry {
  path: string
  body: string | Uint8Array
  /** Kept whole rather than deflated. Only the EPUB's `mimetype` needs it. */
  stored?: boolean
}

/** The zip's bytes. JSZip is loaded when a package is actually built, so a
 *  window that exports a page never pays for it. */
export async function zipOf(entries: readonly Entry[]): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  for (const entry of entries) {
    zip.file(entry.path, entry.body, entry.stored ? { compression: 'STORE' } : {})
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
