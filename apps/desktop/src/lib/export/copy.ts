/** A file the app is only showing, handed over as it stands.
 *
 *  A paper somebody is reading was not written here and has nothing to convert:
 *  turning it into markdown would be a guess, and turning it into Word would be
 *  two. So it goes out as itself, byte for byte, through the same dialog and the
 *  same download every other export ends in. */

import { fileBytes } from '../bytes'
import { deliver } from './save'

/** What the bytes are, so a browser's own download opens them with the right
 *  program. Anything else is handed over as bytes, with no claim about what they
 *  hold, which is what a browser does with an unknown file anyway. */
const MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** The extension a path ends in, lowercased, or `bin` for a file with none. A
 *  dot in a folder name along the way is not an extension. */
export function extensionOf(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? 'bin'
}

/** What the copy is offered as, which is what the file already is. */
export function mimeOf(path: string): string {
  return MIMES[extensionOf(path)] ?? 'application/octet-stream'
}

/** Copies the file at `path`, and answers where the copy went, or null when the
 *  reader closed the dialog. */
export async function saveCopy(path: string, name: string): Promise<string | null> {
  const extension = extensionOf(path)

  // The dialog names the kind of file, and for a file the app did not write the
  // only honest name for its kind is its own extension.
  return deliver(name, extension, extension.toUpperCase(), {
    bytes: await fileBytes(path),
    mime: mimeOf(path),
  })
}
