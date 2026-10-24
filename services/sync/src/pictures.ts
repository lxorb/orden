/** The pictures a note shows, written down beside it.
 *
 *  A picture in a note is the service's `/i/` and the hash of its bytes, and the bytes
 *  are held by whoever uploaded them. Deleting an account has to know which spaces of
 *  other people show the pictures it alone holds, so it can hand each one to that
 *  space's owner (see erase.ts), and the bodies are in the bucket where nothing can be
 *  asked of them. So every body that is written has its pictures written down here,
 *  from the same place as its words and its reminders (notes.ts), and the nightly sweep
 *  reads the notes written before there was anywhere to put them (blog/fill.ts). */

import { withoutComments } from '@nib/markdown'
import { lines, withoutCode } from '@nib/markdown/links'
import type { Env } from './types'

/** A picture in a note, as the renderer draws one: a markdown image or an HTML image
 *  tag, and the address it names. Only these: a hash written in prose, in a link or in
 *  code is somebody naming the bytes, not a note showing them, and anybody who once
 *  saw a hash could otherwise claim the bytes behind it by writing it down. */
const EMBEDS = [/!\[[^\]]*\]\(\s*<?([^\s)>]+)/g, /<img\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]+)/gi]

/** The service's own address for a picture: its `/i/`, the hash and the extension the
 *  app writes after it, and nothing else on the end of the path. */
const PICTURE = /\/i\/([a-f0-9]{64})(?:\.[a-z0-9]+)?(?:[?#].*)?$/

/** Every picture the service holds that this body shows, outside code and comments. */
export function picturesOf(source: string): Set<string> {
  const found = new Set<string>()
  for (const row of lines(withoutComments(source))) {
    if (row.code) continue
    const text = withoutCode(row.text)
    for (const embed of EMBEDS) {
      for (const match of text.matchAll(embed)) {
        const hash = PICTURE.exec(match[1] ?? '')?.[1]
        if (hash) found.add(hash)
      }
    }
  }
  return found
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
