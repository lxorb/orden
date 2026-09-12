/** The words of a note, indexed so that a site can be searched on the site.
 *
 *  A search box that read every note out of storage would read a thousand
 *  objects to answer one query. So the words go into SQLite's own full-text
 *  index - which D1 carries - written from the one place a note body arrives,
 *  which is the same place the note's front matter is read. One parse of
 *  something already in hand; see notes.ts.
 *
 *  What is indexed is what a reader would read: the path, the title, and the
 *  note's prose with the markup taken out of it, because a search for `image`
 *  should not match every note that has a picture in it. Capped, because an
 *  index is for finding a page and the page itself is one request away.
 *
 *  Nothing here decides what is searchable: the search asks only about the
 *  pages the site publishes, and the index is joined to that list. A private
 *  note is in the index and never in an answer; see blog/find.ts. */

import { stripFrontMatter } from '@nib/markdown/front-matter'
import type { Env } from '../types'

/** How much of a note is indexed. A long essay is twenty thousand characters,
 *  and past that a search is finding the page rather than reading it. */
const MOST_WORDS = 16 * 1024

/** A note's prose, with the markup taken out.
 *
 *  Not a parse: the index wants words, and every construct here is either a
 *  wrapper around words (a link, an emphasis, a heading) or something that is
 *  not prose at all (a fence, a picture's address, an HTML tag). A parse would
 *  be the same answer for ten times the work per save. */
export function plainWords(source: string): string {
  return stripFrontMatter(source)
    // A fence is code, and code is not what somebody is searching a blog for.
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, ' ')
    // A picture is its words, and its address is not words at all.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    // What is left of the marks: emphasis, headings, quotes, rules, list
    // bullets, table pipes, inline code.
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_~`>|#]+/g, ' ')
    .replace(/^[ \t]*[-+][ \t]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MOST_WORDS)
}

/** Puts one note into the index, replacing whatever was there.
 *
 *  Best effort by design, like the version beside it: the note is already
 *  stored, and a search index that could not be written is not a reason to fail
 *  the save that carried it. */
export async function keepWords(
  env: Env,
  note: { id: string; space_id: string; path: string },
  content: string,
  title: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('delete from note_search where note_id = ?').bind(note.id),
    env.DB.prepare(
      'insert into note_search (note_id, space_id, path, title, body) values (?, ?, ?, ?, ?)',
    ).bind(note.id, note.space_id, note.path, title, plainWords(content)),
  ])
}

/** And takes it out again, for a note that has gone for good. */
export async function forgetWords(env: Env, noteId: string): Promise<void> {
  await env.DB.prepare('delete from note_search where note_id = ?').bind(noteId).run()
}
