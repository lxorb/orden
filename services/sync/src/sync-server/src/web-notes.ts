import type { Shut } from './protected'
import type { Env, Whoever } from './types'

const WEB_NOTE = /\.url$/i
export const isWebNote = (note: { path: string; kind?: string | null }): boolean =>
  note.kind === 'url' || WEB_NOTE.test(note.path)
export const WEB_NOTE_UNSHARED = 'a web note keeps its own browser profile, so it cannot be shared or published'
export const webNoteIn = (n: string): string => `(${n}.kind = 'url' or ${n}.path like '%.url')`
export const makerOf = (n: string): string =>
  `coalesce(${n}.made_by, (select user_id from devices where id = ${n}.updated_by),
            (select user_id from spaces where id = ${n}.space_id))`
export const keptFrom = (n: string, who: string): string => `(${webNoteIn(n)} and ${makerOf(n)} is not ${who})`
export const whoIs = (who: Whoever): string => (who.kind === 'user' ? who.user.id : who.guest.id)
export async function madeByAnother(
  env: Env,
  note: { id: string; path: string; kind?: string | null },
  who: Whoever,
): Promise<boolean> {
  if (!isWebNote(note)) return false
  const row = await env.DB.prepare(`select ${makerOf('notes')} as maker from notes where id = ?`)
    .bind(note.id)
    .first<{ maker: string | null }>()
  return row?.maker !== whoIs(who)
}
export async function webNotesKeptFrom(env: Env, who: string, spaceIds: readonly string[]): Promise<Shut> {
  const { results } = await env.DB.prepare(
    `select space_id, path from notes
      where space_id in (select value from json_each(?1)) and deleted = 0 and ${keptFrom('notes', '?2')}`,
  )
    .bind(JSON.stringify([...new Set(spaceIds)]), who)
    .all<{ space_id: string; path: string }>()
  const kept = new Set(results.map((row) => `${row.space_id}\u0000${row.path}`))
  return (spaceId, path) => kept.has(`${spaceId}\u0000${path}`)
}
