import type { EditorView } from '@codemirror/view'
import { renderMarkdown } from '@nib/markdown'
import { imageResolver } from '../images'

/** A note shown rather than edited: the HTML behind an embed and behind the
 *  hover preview.
 *
 *  The same renderer an export and a published page use, so a note reads the
 *  same in all three places, and in its publishing mode: raw HTML in a note is
 *  shown as the characters it is made of rather than run, which matters as much
 *  here as on the web - a note can arrive by sync from anywhere.
 *
 *  No resolver is handed to it, so a `[[…]]` inside an embedded note comes out
 *  as its own words. That is what keeps an embed one level deep. */

const REMOTE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/** Only `&` and `"` matter: what goes back is a URL from the host, into a
 *  double-quoted attribute, and neither character may survive there. */
function attribute(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** The path as the note wrote it. The renderer percent-encodes what it puts in
 *  an attribute; the host resolves the path, not the encoding of it. */
function written(src: string): string {
  try {
    return decodeURI(src.replace(/&amp;/g, '&'))
  } catch {
    return src
  }
}

/** Some markdown as HTML, with the pictures in it pointing where the host says
 *  they live - the same resolver the live preview draws an image with. */
export function renderNote(source: string, view: EditorView): string {
  const html = renderMarkdown(source, { footnotes: true, escapeHtml: true })
  const resolve = view.state.facet(imageResolver)

  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]*)(")/g,
    (whole: string, before: string, src: string, after: string) =>
      REMOTE.test(src) ? whole : `${before}${attribute(resolve(written(src)))}${after}`,
  )
}
