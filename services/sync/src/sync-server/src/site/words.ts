import { withoutComments } from '@orden/markdown'
import { stripFrontMatter } from '@orden/markdown/front-matter'
import type { Env } from '../types'

const MOST_WORDS = 16 * 1024

export function plainWords(source: string): string {
  return withoutComments(stripFrontMatter(source))
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_~`>|#]+/g, ' ')
    .replace(/^[ \t]*[-+][ \t]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MOST_WORDS)
}

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

export function forgetWords(env: Env, noteId: string): D1PreparedStatement {
  return env.DB.prepare('delete from note_search where note_id = ?').bind(noteId)
}
