/** The pictures of a document pandoc read in, kept in the note's space.
 *
 *  pandoc hands them back beside the words rather than writing them anywhere it
 *  likes (see `import_from` in pandoc.rs), each under the link the words name it
 *  by, `media/rId20.png`. They used to stay in a `media` folder beside the
 *  document, outside every space: the note's links were dead, and a second import
 *  from that folder wrote over the first one's pictures of the same name. Here
 *  each goes where a pasted picture goes, named by its contents, and the links
 *  are pointed at it. */

import { fromBase64, sha256 } from '../bytes'

/** One picture as `import_document` returns it: the link the words use, and its
 *  bytes as base64. */
export interface PandocPicture {
  link: string
  data: string
}

/** Writes one picture where the note's pictures go, under `name`, and answers the
 *  link to put in the note, or null when it could not be written; see
 *  `storeBeside` in assets.ts. */
export type StorePicture = (bytes: Uint8Array, name: string) => Promise<string | null>

/** The markdown with every picture stored and its links pointed at the stored
 *  copy, and how many could not be stored, whose links are left as they were. */
export async function keepPictures(
  markdown: string,
  pictures: readonly PandocPicture[],
  store: StorePicture,
): Promise<{ markdown: string; lost: number }> {
  let out = markdown
  let lost = 0

  for (const picture of pictures) {
    const bytes = fromBase64(picture.data)
    // Named by its contents, as a pasted picture is: one import's `image1.png` is
    // never another's, and the same picture imported twice is kept once.
    const name = `${(await sha256(bytes)).slice(0, 16)}${extensionOf(picture.link)}`
    const stored = await store(bytes, name).catch(() => null)
    if (stored === null) {
      lost += 1
      continue
    }
    // Encoded as a pasted picture's link is, since a folder named after the note
    // may hold a space; see insert-picture.ts.
    out = relinked(out, picture.link, encodeURI(stored))
  }

  return { markdown: out, lost }
}

/** The extension a picture's link ends in, with its dot, or nothing. */
function extensionOf(link: string): string {
  const found = /\.([a-z0-9]{1,5})$/i.exec(link)?.[1]
  return found ? `.${found.toLowerCase()}` : ''
}

/** `markdown` with every link to `from` pointing at `to` instead: as the target
 *  of a picture or link, `](media/x.png)` or `](<media/x.png>)`, as a reference's
 *  `]: media/x.png`, and as raw HTML's `src="media/x.png"`, which is how pandoc
 *  writes a picture with a size. With or without a leading `./`, and spelled
 *  with backslashes as a Windows pandoc may spell it. Text that merely mentions
 *  the name is left alone. */
export function relinked(markdown: string, from: string, to: string): string {
  const spellings = [...new Set([from, from.replace(/\//g, '\\')])]
  let out = markdown

  for (const spelling of spellings) {
    const name = `(?:\\.[\\\\/])?${escaped(spelling)}`
    const opening = String.raw`(\]\(<?|\]:[ \t]+<?|\bsrc=["'])`
    const closing = String.raw`(?=[>)"'\s]|$)`
    out = out.replace(
      new RegExp(`${opening}${name}${closing}`, 'g'),
      (_, before) => `${before}${to}`,
    )
  }

  return out
}

/** Text as a pattern that matches only itself. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
