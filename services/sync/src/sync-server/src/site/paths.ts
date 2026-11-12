import { chunks, places } from '../bound'
import type { Env, Note } from '../types'
import { readFront, type NoteFront } from './front'

export function slugFor(path: string): string {
  return path
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .split('/')
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .normalize('NFC'),
    )
    .filter(Boolean)
    .join('/')
}

const MOST_REMEMBERED = 50

export function pathsOf(path: string, front: NoteFront): string[] {
  const where = front.permalink ?? slugFor(path)
  return [...new Set([where, ...(front.aliases ?? [])])].filter(Boolean)
}

export function legacyPathsOf(path: string, front: NoteFront): string[] {
  const asAscii = (slug: string) =>
    slug
      .replace(/[^a-z0-9/_-]+/g, '-')
      .split('/')
      .map((part) => part.replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .join('/')

  const where = front.permalink
    ? asAscii(front.permalink)
    : path
        .replace(/\.(md|markdown|mdown|mkd)$/i, '')
        .split('/')
        .map((part) =>
          part
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        )
        .filter(Boolean)
        .join('/')

  return [...new Set([where, ...(front.aliases ?? []).map(asAscii)])].filter(Boolean)
}

export function pageOf(path: string, front: NoteFront): string {
  return pathsOf(path, front)[0] ?? slugFor(path)
}

export async function rememberOldPaths(
  env: Env,
  was: Pick<Note, 'id' | 'space_id' | 'path' | 'front'>,
  path: string,
  front: NoteFront,
): Promise<void> {
  const before = pathsOf(was.path, readFront(was.front))
  const after = new Set(pathsOf(path, front))
  const gone = before.filter((one) => !after.has(one)).slice(0, MOST_REMEMBERED)
  if (!gone.length) return

  const at = Date.now()
  const writes = gone.map((slug) =>
    env.DB.prepare(
      `insert into blog_paths (space_id, slug, note_id, at) values (?, ?, ?, ?)
        on conflict (space_id, slug) do update set note_id = excluded.note_id, at = excluded.at`,
    ).bind(was.space_id, slug, was.id, at),
  )

  writes.push(
    env.DB.prepare(
      `delete from blog_paths where note_id = ? and slug not in (
         select slug from blog_paths where note_id = ? order by at desc limit ?
       )`,
    ).bind(was.id, was.id, MOST_REMEMBERED),
  )

  await env.DB.batch(writes)
}

const MOST_MOVES_REMEMBERED = 500

export interface Moved {
  id: string
  from: string
  to: string
}

export async function rememberMoves(
  env: Env,
  spaceId: string,
  moves: readonly Moved[],
): Promise<void> {
  if (!moves.length) return
  const space = await env.DB.prepare('select blog_enabled from spaces where id = ?')
    .bind(spaceId)
    .first<{ blog_enabled: number }>()
  if (!space?.blog_enabled) return

  for (const piece of chunks(moves.slice(0, MOST_MOVES_REMEMBERED))) {
    const { results } = await env.DB.prepare(
      `select id, front from notes where space_id = ? and id in (${places(piece.length)})`,
    )
      .bind(spaceId, ...piece.map((one) => one.id))
      .all<{ id: string; front: string | null }>()
    const fronts = new Map(results.map((one) => [one.id, one.front]))
    for (const one of piece) {
      if (!fronts.has(one.id)) continue
      const front = fronts.get(one.id) ?? null
      await rememberOldPaths(
        env,
        { id: one.id, space_id: spaceId, path: one.from, front },
        one.to,
        readFront(front),
      )
    }
  }
}

export async function rememberedNote(
  env: Env,
  spaceId: string,
  slug: string,
): Promise<string | null> {
  const found = await env.DB.prepare(
    'select note_id from blog_paths where space_id = ? and slug = ?',
  )
    .bind(spaceId, slug)
    .first<{ note_id: string }>()

  return found?.note_id ?? null
}
