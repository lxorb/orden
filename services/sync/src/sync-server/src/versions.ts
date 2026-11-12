import { chunks, places } from './bound'
import { byteLength, cleanPersonName, now, sha256 } from './crypto'
import { picturesOf } from './pictures'
import type { Env, Note } from './types'

export const KEEP_DAYS = [30, 365] as const

export const KEEP_FOR = 30 * 24 * 60 * 60 * 1000

const VERSION_EVERY = 5 * 60 * 1000

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const AFTER_A_MONTH = 30 * DAY
const AFTER_THREE = 90 * DAY

export const MOST_VERSION_BYTES = 2 * 1024 * 1024 * 1024

const ACCOUNTS_AT_ONCE = 20

const AT_ONCE = 400

const MOST_SHOWN = 300

export const MOST_KEPT = 1024

const DEVICE_LIMIT = 40

export interface Version {
  note_id: string
  at: number
  hash: string
  size: number
  by: string
}

export function versionKey(hash: string): string {
  return `versions/${hash}`
}

export function presentVersion(version: Version) {
  return { at: version.at, size: version.size, by: version.by, hash: version.hash }
}

export function picturesOfVersion(content: string): string | null {
  try {
    return JSON.stringify([...picturesOf(content, true)])
  } catch {
    return null
  }
}

export function deviceIn(header: string | undefined): string {
  const name = cleanPersonName(header ?? '')
  if (name.length <= DEVICE_LIMIT) return name

  const characters = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(name)

  let out = ''
  let held = 0
  for (const { segment } of characters) {
    if (held === DEVICE_LIMIT) break
    out += segment
    held += 1
  }

  return out
}

export async function keepVersion(
  env: Env,
  note: Pick<Note, 'id' | 'hash' | 'size'>,
  content: string,
  by = '',
  device: string | null = null,
): Promise<void> {
  let stored = false

  for (let tries = 0; tries < 3; tries++) {
    const last = await env.DB.prepare(
      'select at, hash from note_versions where note_id = ? order by at desc limit 1',
    )
      .bind(note.id)
      .first<{ at: number; hash: string }>()

    if (last?.hash === note.hash) break

    if (!stored) {
      const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
        .bind(note.hash)
        .first<{ one: number }>()
      if (!held) await env.NOTES.put(versionKey(note.hash), content)
      stored = true
    }

    const mine = await env.DB.prepare(
      `select v.at as at, v.hash as hash, v.held as held,
              (select max(at) from note_versions where note_id = v.note_id and at < v.at) as before
         from note_versions v
        where v.note_id = ? and v.device is ?
        order by v.at desc limit 1`,
    )
      .bind(note.id, device)
      .first<{ at: number; hash: string; held: number; before: number | null }>()

    const pictures = picturesOfVersion(content)
    const at = now()
    const folds =
      mine !== null &&
      !mine.held &&
      at - mine.at < VERSION_EVERY &&
      mine.before !== null &&
      mine.at - mine.before < VERSION_EVERY

    if (folds) {
      const to = mine.at === last?.at ? Math.max(at, mine.at) : Math.max(at, (last?.at ?? 0) + 1)
      const folded = await env.DB.prepare(
        `update or ignore note_versions set at = ?4, hash = ?5, size = ?6, by = ?7, pictures = ?9
          where note_id = ?1 and at = ?2 and hash = ?3 and held = 0 and device is ?8`,
      )
        .bind(note.id, mine.at, mine.hash, to, note.hash, note.size, by, device, pictures)
        .run()
      if (!folded.meta.changes) continue

      await forgetBodies(env, [mine.hash])
      return
    }

    const kept = await env.DB.prepare(
      `insert or ignore into note_versions (note_id, at, hash, size, by, device, pictures)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(note.id, Math.max(at, (last?.at ?? 0) + 1), note.hash, note.size, by, device, pictures)
      .run()
    if (!kept.meta.changes) continue

    await keepAtMost(env, note.id)
    return
  }

  if (stored) await forgetBodies(env, [note.hash])
}

export async function versionsFit(env: Env, noteId: string, incoming: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `select coalesce(sum(v.size), 0) as bytes
       from note_versions v
       join notes n on n.id = v.note_id
       join spaces s on s.id = n.space_id
      where s.user_id = (select s2.user_id from notes n2 join spaces s2 on s2.id = n2.space_id
                          where n2.id = ?1)`,
  )
    .bind(noteId)
    .first<{ bytes: number }>()
  return (row?.bytes ?? 0) + incoming <= MOST_VERSION_BYTES
}

export async function keepVersionNow(
  env: Env,
  noteId: string,
  content: string,
  by: string,
): Promise<void> {
  const hash = await sha256(content)
  const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
    .bind(hash)
    .first<{ one: number }>()
  if (!held) await env.NOTES.put(versionKey(hash), content)

  const newest = await env.DB.prepare('select max(at) as at from note_versions where note_id = ?')
    .bind(noteId)
    .first<{ at: number | null }>()

  await env.DB.prepare(
    `insert or ignore into note_versions (note_id, at, hash, size, by, held, pictures)
     values (?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      noteId,
      Math.max(now(), (newest?.at ?? 0) + 1),
      hash,
      byteLength(content),
      deviceIn(by),
      picturesOfVersion(content),
    )
    .run()

  await keepAtMost(env, noteId)
}

export async function holdVersion(
  env: Env,
  note: Pick<Note, 'id' | 'hash'>,
  content: string,
  by: string,
): Promise<void> {
  const newest = await env.DB.prepare(
    'select at, hash from note_versions where note_id = ? order by at desc limit 1',
  )
    .bind(note.id)
    .first<{ at: number; hash: string }>()

  if (newest?.hash === note.hash) {
    await env.DB.prepare('update note_versions set held = 1 where note_id = ? and at = ?')
      .bind(note.id, newest.at)
      .run()
    return
  }

  await keepVersionNow(env, note.id, content, by)
}

async function keepAtMost(env: Env, noteId: string): Promise<void> {
  const held = await env.DB.prepare('select count(*) as many from note_versions where note_id = ?')
    .bind(noteId)
    .first<{ many: number }>()

  let over = (held?.many ?? 0) - MOST_KEPT
  const freed: string[] = []

  for (const close of [VERSION_EVERY, HOUR, DAY, WEEK, null]) {
    if (over <= 0) break
    const { results } = await env.DB.prepare(
      `delete from note_versions
        where note_id = ?1
          and at in (select at from (select at, held, lead(at) over (order by at) as next
                                       from note_versions where note_id = ?1)
                      where next is not null and held = ?4
                        and (?3 is null or next - at < ?3)
                      order by at limit ?2)
        returning hash`,
    )
      .bind(noteId, over, close, 0)
      .all<{ hash: string }>()
    over -= results.length
    for (const one of results) freed.push(one.hash)
  }

  if (over > 0) {
    const { results } = await env.DB.prepare(
      `delete from note_versions
        where note_id = ?1
          and at in (select at from note_versions where note_id = ?1
                      and at < (select max(at) from note_versions where note_id = ?1)
                      order by at limit ?2)
        returning hash`,
    )
      .bind(noteId, over)
      .all<{ hash: string }>()
    for (const one of results) freed.push(one.hash)
  }

  await forgetBodies(env, freed)
}

export async function forgetBodies(env: Env, hashes: Iterable<string>): Promise<number> {
  let gone = 0

  for (const hash of new Set(hashes)) {
    const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
      .bind(hash)
      .first<{ one: number }>()

    if (held) continue
    await env.NOTES.delete(versionKey(hash))
    gone += 1
  }

  return gone
}

export async function versionsOf(env: Env, noteId: string): Promise<Version[]> {
  const { results } = await env.DB.prepare(
    'select * from note_versions where note_id = ? order by at desc limit ?',
  )
    .bind(noteId, MOST_SHOWN)
    .all<Version>()

  return results
}

export async function versionAt(env: Env, noteId: string, at: number): Promise<string | null> {
  const version = await env.DB.prepare(
    'select hash from note_versions where note_id = ? and at = ?',
  )
    .bind(noteId, at)
    .first<{ hash: string }>()

  if (!version) return null

  const object = await env.NOTES.get(versionKey(version.hash))
  return object ? await object.text() : null
}

export async function saidOnce(
  env: Env,
  note: Pick<Note, 'id' | 'hash'>,
  hash: string,
): Promise<boolean> {
  if (note.hash === hash) return true

  const row = await env.DB.prepare(
    'select 1 as one from note_versions where note_id = ? and hash = ? limit 1',
  )
    .bind(note.id, hash)
    .first<{ one: number }>()

  return row !== null
}

export async function saidAs(env: Env, noteId: string, hash: string): Promise<string | null> {
  if (!(await saidOnce(env, { id: noteId, hash: '' }, hash))) return null

  const object = await env.NOTES.get(versionKey(hash))
  return object ? await object.text() : null
}

function folderPrefix(under: string): string {
  const folder = under.replace(/\/+$/, '')
  return folder ? `${folder}/` : ''
}

export async function versionsAt(
  env: Env,
  spaceId: string,
  under: string,
  at: number,
): Promise<{ note_id: string; path: string; hash: string }[]> {
  const prefix = folderPrefix(under)

  const { results } = await env.DB.prepare(
    `select v.note_id as note_id, n.path as path, v.hash as hash
       from note_versions v
       join notes n on n.id = v.note_id
      where n.space_id = ?1 and substr(n.path, 1, length(?2)) = ?2 and v.at <= ?3
        and (v.hash != n.hash or n.deleted = 1)
        and (n.updated_at > ?3 or n.deleted = 1)
        and (n.deleted = 0 or (n.deleted_at is not null and n.deleted_at > ?3))
        and v.at = (select max(at) from note_versions where note_id = v.note_id and at <= ?3)
      order by n.path
      limit ?4`,
  )
    .bind(spaceId, prefix, at, AT_ONCE)
    .all<{ note_id: string; path: string; hash: string }>()

  return results
}

const HORIZON = "coalesce(json_extract(u.settings, '$.keepVersions'), ?2) * 86400000"

const SHELF = 'case when at < ?3 then ?4 when at < ?5 then ?6 else ?7 end'

export async function sweepVersions(env: Env, at: number): Promise<number> {
  const freed = new Set<string>()

  const old = await env.DB.prepare(
    `delete from note_versions
      where rowid in (
        select v.rowid from note_versions v
          join notes n on n.id = v.note_id
          join spaces s on s.id = n.space_id
          left join users u on u.id = s.user_id
         where v.at < ?1 - ${HORIZON}
         limit ?3
      )
      returning hash`,
  )
    .bind(at, KEEP_FOR / DAY, AT_ONCE)
    .all<{ hash: string }>()

  for (const row of old.results) freed.add(row.hash)

  const { results: busy } = await env.DB.prepare(
    'select distinct note_id from note_versions where at < ? limit ?',
  )
    .bind(at - DAY, AT_ONCE)
    .all<{ note_id: string }>()

  for (const one of busy) {
    const thinned = await env.DB.prepare(
      `delete from note_versions
        where note_id = ?1 and at < ?2
          and held = 0
          and at not in (select max(at) from note_versions
                          where note_id = ?1 and at < ?2 and held = 0
                          group by ${SHELF}, cast(at / (${SHELF}) as integer))
        returning hash`,
    )
      .bind(one.note_id, at - DAY, at - AFTER_THREE, WEEK, at - AFTER_A_MONTH, DAY, HOUR)
      .all<{ hash: string }>()

    for (const row of thinned.results) freed.add(row.hash)
  }

  return (await forgetBodies(env, freed)) + (await capVersions(env))
}

async function capVersions(env: Env): Promise<number> {
  const { results: over } = await env.DB.prepare(
    `select s.user_id as user_id, sum(v.size) as bytes
       from note_versions v
       join notes n on n.id = v.note_id
       join spaces s on s.id = n.space_id
      group by s.user_id
     having bytes > ?1
      limit ?2`,
  )
    .bind(MOST_VERSION_BYTES, ACCOUNTS_AT_ONCE)
    .all<{ user_id: string; bytes: number }>()

  const freed = new Set<string>()

  for (const account of over) {
    let held = account.bytes

    for (let round = 0; round < 4 && held > MOST_VERSION_BYTES; round++) {
      const { results: oldest } = await env.DB.prepare(
        `select v.rowid as id, v.hash as hash, v.size as size
           from note_versions v
           join notes n on n.id = v.note_id
           join spaces s on s.id = n.space_id
          where s.user_id = ?1
          order by v.at
          limit ?2`,
      )
        .bind(account.user_id, AT_ONCE)
        .all<{ id: number; hash: string; size: number }>()

      if (!oldest.length) break

      const going: number[] = []
      for (const row of oldest) {
        if (held <= MOST_VERSION_BYTES) break

        going.push(row.id)
        freed.add(row.hash)
        held -= row.size
      }

      if (!going.length) break

      for (const chunk of chunks(going)) {
        await env.DB.prepare(`delete from note_versions where rowid in (${places(chunk.length)})`)
          .bind(...chunk)
          .run()
      }
    }
  }

  return await forgetBodies(env, freed)
}

export const ROLLBACK_AT_ONCE = AT_ONCE

export async function countVersionsAt(
  env: Env,
  spaceId: string,
  under: string,
  at: number,
): Promise<number> {
  const prefix = folderPrefix(under)

  const found = await env.DB.prepare(
    `select count(*) as held from note_versions v
       join notes n on n.id = v.note_id
      where n.space_id = ?1 and substr(n.path, 1, length(?2)) = ?2 and v.at <= ?3
        and (v.hash != n.hash or n.deleted = 1)
        and (n.updated_at > ?3 or n.deleted = 1)
        and (n.deleted = 0 or (n.deleted_at is not null and n.deleted_at > ?3))
        and v.at = (select max(at) from note_versions where note_id = v.note_id and at <= ?3)`,
  )
    .bind(spaceId, prefix, at)
    .first<{ held: number }>()

  return found?.held ?? 0
}

export function forgetVersions(env: Env, noteId: string): D1PreparedStatement {
  return env.DB.prepare('delete from note_versions where note_id = ? returning hash').bind(noteId)
}
