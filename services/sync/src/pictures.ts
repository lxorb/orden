/** The pictures a note shows, written down beside it.
 *
 *  A picture in a note is the service's `/i/` and the hash of its bytes, and the bytes
 *  are held by whoever uploaded them. Deleting an account has to know which spaces of
 *  other people show the pictures it alone holds, so it can hand each one to that
 *  space's owner (see erase.ts), and the bodies are in the bucket where nothing can be
 *  asked of them. So every body that is written has its pictures written down here,
 *  from the same place as its words and its reminders (notes.ts), and the nightly sweep
 *  reads the notes written before there was anywhere to put them (blog/fill.ts). */

import { lexMarkdown, withoutComments } from '@nib/markdown'
import { coverOf } from '@nib/markdown/cover'
import { frontMatterValue, stripFrontMatter } from '@nib/markdown/front-matter'
import { withoutBlockIds } from '@nib/markdown/links'
import type { Env } from './types'

/** An HTML image tag's source, as a browser reads it: the attribute named `src` and no
 *  other, which may sit on a line of its own inside the tag. */
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]+)/gi

/** The keys of a note's front matter beside its cover that hold a picture the app
 *  shows: the image its published page is shared with. */
const FRONT_PICTURES = ['image'] as const

/** The service's own address for a picture: its `/i/`, the hash and the extension the
 *  app writes after it, and nothing else on the end of the path. */
const PICTURE = /\/i\/([a-f0-9]{64})(?:\.[a-z0-9]+)?(?:[?#].*)?$/i

/** Every picture the service holds that this body shows: in its prose, as its cover,
 *  or - for a canvas, which is JSON - on one of its cards.
 *
 *  The prose is read through the same grammar that renders it (`lexMarkdown`, the
 *  package's own tokens), so what counts here is exactly what a reader is drawn: a
 *  markdown image however its address is given - inline, by reference, by shortcut -
 *  an embed of the address in double brackets, and the source of an HTML image tag.
 *  Nothing else: a hash in prose, in a link, in code, escaped or in a comment is
 *  somebody naming the bytes, not a note showing them, and anybody who once saw a hash
 *  could otherwise claim the bytes behind it by writing it down. */
export function picturesOf(source: string): Set<string> {
  const found = new Set<string>()
  const add = (address: string | null | undefined) => {
    const hash = address ? PICTURE.exec(address.trim())?.[1] : undefined
    if (hash) found.add(hash.toLowerCase())
  }

  const canvas = cardsOf(source)
  if (canvas) {
    // A picture card names its picture's address whole, as a group names the picture
    // behind it; a text card is markdown like a note.
    for (const card of canvas) {
      if (card.type === 'file') add(card.file)
      add(card.background)
      if (typeof card.text === 'string') for (const hash of picturesOf(card.text)) found.add(hash)
    }
    return found
  }

  add(coverOf(source)?.src)
  for (const key of FRONT_PICTURES) add(frontMatterValue(source, key))

  // What `renderMarkdown` parses: the body without its front matter, its block names
  // and its comments.
  const tokens = lexMarkdown(withoutComments(withoutBlockIds(stripFrontMatter(source))))
  visit(tokens, add)
  return found
}

/** Every picture a run of tokens draws, handed to `add`, at any depth: a list's items,
 *  a table's cells, a quote's paragraphs and a link's words all hold tokens of their
 *  own. Code holds none, so it is never looked inside. */
function visit(value: unknown, add: (address: string | undefined) => void): void {
  if (Array.isArray(value)) {
    for (const one of value) visit(one, add)
    return
  }
  if (!value || typeof value !== 'object') return

  const token = value as { type?: unknown; href?: unknown; text?: unknown; link?: unknown }
  if (token.type === 'code' || token.type === 'codespan') return
  if (token.type === 'image' && typeof token.href === 'string') add(token.href)
  if (token.type === 'html' && typeof token.text === 'string') {
    for (const match of token.text.matchAll(IMG_SRC)) add(match[1])
  }
  // `![[…]]`, as a block of its own or inside a line.
  if (token.type === 'embed' || token.type === 'wikilink') {
    const link = token.link as { embed?: boolean; target?: string } | undefined
    if (link?.embed) add(link.target)
  }

  for (const inner of Object.values(token)) {
    if (inner && typeof inner === 'object') visit(inner, add)
  }
}

/** What a canvas card says that can hold a picture. */
interface Card {
  type: unknown
  file: string | undefined
  background: string | undefined
  text: unknown
}

/** The cards of a canvas, or null for a body that is not one. */
function cardsOf(source: string): Card[] | null {
  if (!source.trimStart().startsWith('{')) return null
  try {
    const parsed = JSON.parse(source) as { nodes?: unknown }
    if (!Array.isArray(parsed.nodes)) return null
    return parsed.nodes
      .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
      .map((node) => ({
        type: node.type,
        file: typeof node.file === 'string' ? node.file : undefined,
        background: typeof node.background === 'string' ? node.background : undefined,
        text: node.text,
      }))
  } catch {
    return null
  }
}

/** Rewrites a note's pictures from its body, replacing whatever an earlier save wrote.
 *
 *  Best effort, as the note's words and versions are: the note is already stored. But a
 *  picture missing here is one a deleted account would not hand over, so a note whose
 *  pictures could not be written is marked unread, and the nightly sweep reads it again.
 *  Answers whether they were written, for the sweep, which writes the mark itself. */
export async function keepPictures(
  env: Env,
  note: { id: string },
  content: string,
): Promise<boolean> {
  try {
    await env.DB.batch([
      env.DB.prepare('delete from note_pictures where note_id = ?').bind(note.id),
      env.DB.prepare(
        `insert or ignore into note_pictures (note_id, hash)
           select ?1, value from json_each(?2)`,
      ).bind(note.id, JSON.stringify([...picturesOf(content)])),
    ])
    return true
  } catch {
    await env.DB.prepare('update notes set front_rev = 0 where id = ?')
      .bind(note.id)
      .run()
      .catch(() => undefined)
    return false
  }
}

/** And takes them away again, for a note whose words have gone for good. */
export async function forgetPictures(env: Env, noteId: string): Promise<void> {
  await env.DB.prepare('delete from note_pictures where note_id = ?').bind(noteId).run()
}
