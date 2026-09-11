/** A ` ```query ` fence: a search written into a note, answered where it stands.
 *
 *  The rows are the Search panel's rows, in the same shapes from the themes
 *  package - a word above each note, a line under it - because they say the same
 *  thing and a second design for it would be a second thing to keep in step. As
 *  HTML rather than as a component, because the two surfaces that draw one are
 *  both handed HTML: a widget inside the editor, and one `innerHTML` in the
 *  reading view.
 *
 *  The fence stays a `query` fence, which is Obsidian's own spelling, so a note
 *  carrying one opens there as a code block rather than as something broken. A
 *  published page leaves it as code too, and that is deliberate: a page is one
 *  file served from a cache, and answering a query over the space would be one
 *  read per note on every view. What it would say is also a lie the moment
 *  another note is written, and a stale list presented as a live one is worse
 *  than the query it came from.
 *
 *  Nothing here writes and nothing here is reactive: it is asked, it answers, and
 *  the surface that asked draws the answer. */

import type { Hit } from './search/match'
import { parseQuery } from './search/query'
import { searchSpace } from './search/space'

/** How many rows a fence in a note is worth. Past this it is a second copy of the
 *  space sitting in the middle of a note, and the Search panel is where a list
 *  that long is read. */
const MOST = 40

/** How many rows one note may fill of them, so one long note cannot be the whole
 *  answer. The panel has no such limit because it is a panel; a fence is a
 *  paragraph. */
const PER_NOTE = 5

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (one) => ESCAPES[one] ?? one)
}

/** A note's name as a row says it: without the extension every note has. */
function shown(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, '')
}

/** The query a fence holds. Every line of it, joined, because a fence is a box
 *  and a reader will put a long query on two lines; the grammar reads a newline
 *  as the space between two terms anyway. */
function queryIn(code: string): string {
  return code.trim().replace(/\s*\n\s*/g, ' ')
}

/** Consecutive hits from one note, as the groups the panel draws. */
function grouped(hits: readonly Hit[]): { name: string; hits: Hit[] }[] {
  const out: { name: string; hits: Hit[] }[] = []

  for (const hit of hits) {
    const last = out.at(-1)
    if (last && last.hits[0]?.path === hit.path) {
      if (last.hits.length < PER_NOTE) last.hits.push(hit)
    } else out.push({ name: hit.name, hits: [hit] })
  }

  return out
}

/** One line, with what matched in it marked. */
function line(hit: Hit): string {
  let out = ''
  let at = 0

  for (const range of hit.ranges) {
    if (range.from > at) out += escape(hit.text.slice(at, range.from))
    out += `<mark>${escape(hit.text.slice(range.from, range.to))}</mark>`
    at = range.to
  }

  return out + escape(hit.text.slice(at))
}

/** What one fence answers with, or null where there is nothing to answer from:
 *  no space open, or a query that asks nothing.
 *
 *  A row carries the note and the line it is, so whatever drew it can open it
 *  without knowing anything else about searching. */
export async function queryRowsHtml(code: string, nothing: string): Promise<string | null> {
  const said = queryIn(code)
  if (!said) return null

  const { workspace } = await import('./workspace.svelte')
  const root = workspace.activeSpace?.root
  if (!root) return null

  const query = parseQuery(said)
  const hits: Hit[] = []
  await searchSpace(
    root,
    query,
    [],
    MOST,
    (batch) => hits.push(...batch.hits),
    workspace.excluded.of(root),
  ).catch(() => undefined)

  if (!hits.length)
    return `<div class="nib-query"><p class="nib-query-none">${escape(nothing)}</p></div>`

  const groups = grouped(hits)
    .map((group) => {
      const rows = group.hits
        .map(
          (hit) =>
            `<button type="button" class="nib-row is-short" data-path="${escape(hit.path)}"` +
            ` data-line="${hit.line}">${line(hit)}</button>`,
        )
        .join('')

      return `<p class="nib-section">${escape(shown(group.name))}<span>${group.hits.length}</span></p>${rows}`
    })
    .join('')

  return `<div class="nib-query">${groups}</div>`
}

/** A row in a fence, pressed: the note opens and the line is gone to, the way a
 *  row in the Search panel opens.
 *
 *  The workspace is imported here rather than at the top for the reason
 *  workspace/folder-icons gives about the syncing loop: the link index hands this
 *  to the editor, and the workspace owns the link index. */
export async function openQueryRow(path: string, line: number): Promise<void> {
  const { workspace } = await import('./workspace.svelte')
  await workspace.open(path)
  // The same way a bookmarked block opens: the workspace says where, and whichever
  // pane is showing the note goes there. See `goto`.
  workspace.goto = { path, line }
}
