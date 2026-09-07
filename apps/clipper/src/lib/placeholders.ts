/** Where a picture goes until there is a blob to point at.
 *
 *  The converter cannot write a picture's final address: the bytes are still on
 *  the site at that point, and the address is the hash of bytes nobody has yet.
 *  So it numbers the pictures and this puts addresses in afterwards - the
 *  original ones for the preview, the account's own for the note that is saved.
 *
 *  Its own file because the popup fills placeholders in and has no business
 *  carrying the converter and the HTML parser behind it. */

/** A shape nothing in a page's prose can be mistaken for, and short enough to
 *  read in a preview. */
export const PLACEHOLDER = 'nib:'

export function fill(markdown: string, urls: string[]): string {
  return markdown.replace(
    new RegExp(`\\]\\(${PLACEHOLDER}(\\d+)\\)`, 'g'),
    (whole, digits: string) => {
      const url = urls[Number(digits)]
      return url === undefined ? whole : `](${encodeURI(url)})`
    },
  )
}
