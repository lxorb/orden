import type { EditorState } from '@codemirror/state'
import { renderMarkdown } from '@nib/markdown'
import { loadFor } from '@nib/markdown/engines'
import { mapSources } from '@nib/markdown/sources'
import { attributeValue } from '../attributes'
import { imageResolver } from '../images'
import { noteIndex } from './notes'

/** A note shown rather than edited: the HTML behind an embed and behind the
 *  hover preview.
 *
 *  One call, and it is the app's. `NoteIndex.render` is the reading view's own
 *  render, so a note inside an `![[embed]]` and a note glanced at over a link are
 *  that note's reading view - coloured fences, drawn diagrams, callouts, tables,
 *  maths, task boxes, its metadata as rows, the notes it embeds, its pictures
 *  resolved from where it sits. A second, thinner rendering here is exactly how
 *  the preview came to show a code block with no colours in it.
 *
 *  What is below is the editor standing on its own - no app around it, nothing
 *  that can colour a fence or read another note - and is the least a renderer can
 *  do rather than a second opinion about how a note should look. */

const REMOTE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/** The path as the note wrote it. The renderer percent-encodes what it puts in
 *  an attribute; the host resolves the path, not the encoding of it. */
function written(src: string): string {
  try {
    return decodeURI(src.replace(/&amp;/g, '&'))
  } catch {
    return src
  }
}

/** Some markdown as HTML. `path` is the note it came out of, relative to the
 *  space, so its pictures and its links resolve from where it sits rather than
 *  from the note in the pane - an embed and a preview show another file.
 *
 *  Handed a state rather than a view: nothing here needs a viewport, and a render
 *  that needs no DOM is one a test can compare against the reading view's. */
export async function renderNote(
  source: string,
  path: string | null,
  state: EditorState,
): Promise<string> {
  const host = state.facet(noteIndex).render
  if (host) return host(source, path)

  // The formula engine and the emoji table, where this note wants either: loaded on
  // demand rather than at startup, and a preview is already a round trip. See
  // @nib/markdown/engines.
  await loadFor(source)

  // No app: raw HTML in a note is shown as the characters it is made of, since
  // nothing here can ask whose note it is, and the pictures go through the one
  // resolver the editor does have - the open note's, which is the best a view
  // with no space around it can say about a file it cannot see.
  const html = renderMarkdown(source, { footnotes: true, escapeHtml: true })
  const resolve = state.facet(imageResolver)

  return mapSources(html, (src) =>
    REMOTE.test(src) ? null : attributeValue(resolve(written(src))),
  )
}
