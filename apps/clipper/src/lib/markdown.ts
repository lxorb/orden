/** An article, as the note the app would have written.
 *
 *  The conversion itself is `@nib/markdown/from-html`, shared with the editor's
 *  own paste so that a page clipped here and the same page pasted into a note
 *  come out as the same markdown. What is left here is the one thing only the
 *  clipper needs: pictures come out as placeholders rather than addresses.
 *
 *  Their bytes are not here yet. The service worker fetches them and uploads them
 *  to the account, and only then is there a blob to point at. So the converter
 *  numbers them and `fill` puts the addresses in, once for the preview and again
 *  for the note that is saved. */

import { htmlToMarkdown } from '@nib/markdown/from-html'
import { PLACEHOLDER } from './placeholders'

export interface Converted {
  markdown: string
  /** Where each picture is now, in the order the placeholders name them. */
  images: string[]
}

export function toMarkdown(html: string): Converted {
  const images: string[] = []

  // The same picture twice in one article is one upload and one blob, so each
  // address is looked up before it is added. Kept as a map rather than scanned
  // for in the list: a page whose article the extractor could not read hands
  // over its whole body, and a gallery of thousands of pictures would otherwise
  // cost a pass over everything numbered so far for every one of them.
  const numbered = new Map<string, number>()

  const markdown = htmlToMarkdown(html, {
    image: (source) => {
      let index = numbered.get(source)

      if (index === undefined) {
        index = images.push(source) - 1
        numbered.set(source, index)
      }

      return `${PLACEHOLDER}${index}`
    },
  })

  return { markdown, images }
}
