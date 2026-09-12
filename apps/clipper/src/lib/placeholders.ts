/** Where a picture goes until there is a blob to point at.
 *
 *  The converter cannot write a picture's final address: the bytes are still on
 *  the site at that point, and the address is the hash of bytes nobody has yet.
 *  So it numbers the pictures and this puts addresses in afterwards - the
 *  original ones for the preview, the account's own for the note that is saved.
 *
 *  Its own file because the popup fills placeholders in and has no business
 *  carrying the converter and the HTML parser behind it. */

import { destination } from '@nib/markdown/from-html'

/** A shape nothing in a page's prose can be mistaken for, and short enough to
 *  read in a preview. */
export const PLACEHOLDER = 'nib:'

/** The address goes in the way the converter writes every other one: through
 *  `destination` in @nib/markdown/from-html, which percent-encodes what markdown
 *  reads inside a destination and leaves the rest alone. This had its own copy
 *  built on `encodeURI`, which also escapes the percent - so an address the page
 *  had already escaped was saved escaping its own escapes. */
export function fill(markdown: string, urls: string[]): string {
  return markdown.replace(
    new RegExp(`\\]\\(${PLACEHOLDER}(\\d+)\\)`, 'g'),
    (whole, digits: string) => {
      const url = urls[Number(digits)]
      return url === undefined ? whole : `](${destination(url)})`
    },
  )
}
