import { askInChunks, chunks, places } from './bound'
import { eraseChats } from './chats/ask'
import { note } from './failed'
import { ISSUES, withdrawIssues } from './feedback-issues'
import { eraseHubs } from './hub/reach'
import { eraseMachines } from './machines/ask'
import type { Env } from './types'
import { eraseRooms } from './rooms'

const PER_DELETE = 1000

const OBJECTS_AT_ONCE = 2 * PER_DELETE
const ROOMS_AT_ONCE = 200

const ROOM = 'rooms/'
const HUB = 'hubs/'
const MACHINE = 'machines/'
const CHAT = 'chats/'
const HOME = 'homes/'

const WORDS = 'words/'

const WORDS_AT_ONCE = 100

export function wordsLeftover(noteId: string): string {
  return WORDS + noteId
}

const isObject = (name: string) =>
  name.startsWith(ROOM) ||
  name.startsWith(HUB) ||
  name.startsWith(MACHINE) ||
  name.startsWith(CHAT) ||
  name.startsWith(ISSUES)

async function sweepWords(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    'select what from leftovers where what like ? order by since, what limit ?',
  )
    .bind(`${WORDS}%`, WORDS_AT_ONCE)
    .all<{ what: string }>()
  if (!results.length) return 0

  const names = results.map((one) => one.what)
  const ids = names.map((one) => one.slice(WORDS.length))
  try {
    await env.DB.batch([
      env.DB.prepare(
        'delete from note_search where note_id in (select value from json_each(?))',
      ).bind(JSON.stringify(ids)),
      env.DB.prepare('delete from leftovers where what in (select value from json_each(?))').bind(
        JSON.stringify(names),
      ),
    ])
  } catch (error) {
    note('leftovers words', error, null)
    return 0
  }
  return names.length
}

export async function sweepLeftovers(env: Env): Promise<number> {
  const words = await sweepWords(env)

  const taken = async (sql: string, most: number) =>
    (
      await env.DB.prepare(sql)
        .bind(`${ROOM}%`, `${HUB}%`, `${MACHINE}%`, `${CHAT}%`, `${ISSUES}%`, most, `${WORDS}%`)
        .all<{ what: string }>()
    ).results

  const results = [
    ...(await taken(
      `select what from leftovers where what not like ?1 and what not like ?2
          and what not like ?3 and what not like ?4 and what not like ?5
          and what not like ?7
        order by since, what limit ?6`,
      OBJECTS_AT_ONCE,
    )),
    ...(await taken(
      `select what from leftovers where (what like ?1 or what like ?2 or what like ?3
          or what like ?4 or what like ?5) and what not like ?7
        order by since, what limit ?6`,
      ROOMS_AT_ONCE,
    )),
  ]

  const names = results.map((one) => one.what)
  if (!names.length) return words

  const named = await stillNamed(env, names)
  const loose = names.filter((one) => !named.has(one))

  const objects = loose.filter((one) => !isObject(one) && !one.startsWith(HOME))
  for (const piece of chunks(objects, PER_DELETE)) await env.NOTES.delete(piece)

  const homes = loose.filter((one) => one.startsWith(HOME))
  const homesBucket = env.HOMES
  if (homesBucket) {
    for (const piece of chunks(homes, PER_DELETE)) {
      await homesBucket.delete(piece.map((one) => one.slice(HOME.length)))
    }
  }

  const of = (prefix: string) =>
    loose.filter((one) => one.startsWith(prefix)).map((one) => one.slice(prefix.length))
  const emptied = new Set([
    ...(await eraseRooms(env, of(ROOM))).map((id) => ROOM + id),
    ...(await eraseHubs(env, of(HUB))).map((id) => HUB + id),
    ...(await eraseMachines(env, of(MACHINE))).map((id) => MACHINE + id),
    ...(await eraseChats(env, of(CHAT))).map((id) => CHAT + id),
    ...(await withdrawIssues(env, of(ISSUES).map(Number))).map((n) => ISSUES + String(n)),
    ...(homesBucket ? homes : []),
  ])

  const done = names.filter(
    (one) => (!isObject(one) && !one.startsWith(HOME)) || named.has(one) || emptied.has(one),
  )

  for (const chunk of chunks(done)) {
    await env.DB.prepare(`delete from leftovers where what in (${places(chunk.length)})`)
      .bind(...chunk)
      .run()
  }

  const rooms = done.filter((one) => one.startsWith(ROOM)).map((one) => one.slice(ROOM.length))
  for (const chunk of chunks(rooms)) {
    await env.DB.prepare(
      `delete from retired_notes
        where id in (${places(chunk.length)})
          and not exists (select 1 from leftovers
                           where what in ('rooms/' || retired_notes.id, 'crdt/' || retired_notes.id)
                              or what like 'spaces/%/' || retired_notes.id)`,
    )
      .bind(...chunk)
      .run()
  }

  return done.length
}

async function stillNamed(env: Env, names: readonly string[]): Promise<Set<string>> {
  const byNote = new Map<string, string>()
  const versions = new Map<string, string>()
  const blobs = new Map<string, string>()
  const chats = new Map<string, string>()
  const passFiles = new Map<string, string>()

  for (const name of names) {
    const [kind, ...rest] = name.split('/')
    const last = rest[rest.length - 1] ?? ''

    if (kind === 'spaces' || kind === 'rooms' || kind === 'crdt') byNote.set(name, last)
    else if (kind === 'versions') versions.set(name, last)
    else if (kind === 'blobs') blobs.set(name, last)
    else if (kind === 'chats') chats.set(name, last)
    else if (kind === 'pass') passFiles.set(name, rest.slice(1).join('/'))
  }

  const notes = await askIn(
    env,
    'select id as one from notes where not (deleted = 1 and deleted_at is null) and id in',
    byNote,
  )
  const heldVersions = await askIn(
    env,
    'select distinct hash as one from note_versions where hash in',
    versions,
  )
  const heldBlobs = await askIn(env, 'select distinct hash as one from blobs where hash in', blobs)
  const heldChats = await askIn(env, 'select id as one from chats where id in', chats)

  const heldPassFiles = await askIn(
    env,
    `select item_id || '/' || file_id || '/' || part as one from pass_file_parts
      where item_id || '/' || file_id || '/' || part in`,
    passFiles,
  )

  return new Set([...notes, ...heldVersions, ...heldBlobs, ...heldChats, ...heldPassFiles])
}

async function askIn(
  env: Env,
  question: string,
  keys: ReadonlyMap<string, string>,
): Promise<string[]> {
  const found = await askInChunks([...new Set(keys.values())], async (chunk) => {
    const { results } = await env.DB.prepare(`${question} (${places(chunk.length)})`)
      .bind(...chunk)
      .all<{ one: string }>()

    return results.map((row) => row.one)
  })

  const there = new Set(found)
  return [...keys].filter(([, key]) => there.has(key)).map(([name]) => name)
}
