/** A file the app is only showing, handed over as it stands.
 *
 *  A paper somebody is reading was not written here and has nothing to convert:
 *  turning it into markdown would be a guess, and turning it into Word would be
 *  two. So it goes out as itself, byte for byte, through the same dialog and the
 *  same download every other export ends in. */

import { fileBytes } from '../bytes'
import { mimeOfPath, UNKNOWN_TYPE } from '../mime'
import { deliver } from './save'

/** The extension a path ends in, lowercased, or `bin` for a file with none. A
 *  dot in a folder name along the way is not an extension. */
export function extensionOf(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? 'bin'
}

/** What the copy is offered as, which is what the file already is. A file whose
 *  name says nothing goes over as bytes, with no claim about what they hold,
 *  which is what a browser does with an unknown file anyway. */
export function mimeOf(path: string): string {
  return mimeOfPath(path) ?? UNKNOWN_TYPE
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
