import { now } from './crypto'
import { goneMessage, mailer } from './email'
import { note } from './failed'
import { releaseDomain } from './hostnames'
import { ERASING, sweepLeftovers } from './leftovers'
import { closeRooms } from './rooms'
import { type Ended, hooks } from './hooks'
import type { Env, User } from './types'
import { handedTo, unreadUses, usedElsewhere } from './used'

const OWNED = 'select id from spaces where user_id = ?1'
const OWNED_NOTES = `select id from notes where space_id in (${OWNED})`
const OWNED_CHATS = `select id from chats where space_id in (${OWNED})`

const THEIR_TERMS = `ended_at is null and user_id <> ?1 and term <> session and term in (${OWNED_NOTES})`
const THEIR_TERMS_LIVE = `select machine, session, user_id from term_sessions where ${THEIR_TERMS}`

const NOTED: readonly string[] = [
  `insert or ignore into leftovers (what, since)
     select 'spaces/' || space_id || '/' || id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into leftovers (what, since)
     select 'rooms/' || id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into leftovers (what, since)
     select 'crdt/' || id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into retired_notes (id, since)
     select id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into leftovers (what, since)
     select distinct 'versions/' || hash, ?3 from note_versions where note_id in (${OWNED_NOTES})`,
  `insert or ignore into leftovers (what, since)
     select 'blobs/' || hash, ?3 from blobs where user_id = ?1`,
  `insert or ignore into leftovers (what, since)
     select 'web/' || user_id || '/' || key, ?3 from web_states where user_id = ?1`,
  `insert or ignore into leftovers (what, since)
     select 'web/' || user_id || '/chunks/' || name, ?3 from web_chunks where user_id = ?1`,
  `insert or ignore into leftovers (what, since) values ('hubs/' || ?1, ?3)`,
  `insert or ignore into leftovers (what, since)
     select 'machines/' || id, ?3 from machines where user_id = ?1`,
  `insert or ignore into leftovers (what, since)
     select 'homes/' || backup_key, ?3 from machines where user_id = ?1 and backup_key is not null`,
  `insert or ignore into leftovers (what, since) select 'chats/' || id, ?3 from (${OWNED_CHATS})`,
  `insert or ignore into leftovers (what, since)
     select 'issues/' || issue_number, ?3 from feedback
      where user_id = ?1 and issue_number is not null`,
  `insert or ignore into leftovers (what, since)
     select 'feedback/' || feedback_id || '/' || name, ?3 from feedback_images
      where feedback_id in (select id from feedback where user_id = ?1)`,
  `update chats set last_by = null
    where last_by = 'user:' || ?1`,
]

export function erased(): readonly (readonly [table: string, sql: string])[] {
  return [
    ['note_versions', `delete from note_versions where note_id in (${OWNED_NOTES})`],
    ['note_search', `delete from note_search where space_id in (${OWNED})`],
    ['note_pictures', `delete from note_pictures where note_id in (${OWNED_NOTES})`],
    ['blog_paths', `delete from blog_paths where space_id in (${OWNED})`],
    ['form_answers', `delete from form_answers where space_id in (${OWNED})`],
    ['room_sockets', `delete from room_sockets where space_id in (${OWNED}) or who = ?1`],
    ['chat_reads', `delete from chat_reads where chat_id in (${OWNED_CHATS}) or who = ?1`],
    ['chat_files', `delete from chat_files where chat_id in (${OWNED_CHATS})`],
    [
      'chat_sockets',
      `delete from chat_sockets
        where chat_id in (${OWNED_CHATS}) or who = ?1`,
    ],
    ['chats', `delete from chats where space_id in (${OWNED})`],
    ['space_members', `delete from space_members where space_id in (${OWNED}) or email = ?2`],
    ['space_links', `delete from space_links where space_id in (${OWNED})`],
    ['space_requests', `delete from space_requests where space_id in (${OWNED}) or email = ?2`],
    ['guest_members', `delete from guest_members where space_id in (${OWNED})`],
    ['once_shared', `delete from once_shared where space_id in (${OWNED})`],
    ['guests', 'update guests set email = null where email = ?2'],
    ['notes', `delete from notes where space_id in (${OWNED})`],
    ['folders', `delete from folders where space_id in (${OWNED})`],
    ['tree_ops', `delete from tree_ops where space_id in (${OWNED})`],
    ['space_entries', `delete from space_entries where space_id in (${OWNED})`],
    ['space_cursor', `delete from space_cursor where space_id in (${OWNED})`],
    ['space_nicks', `delete from space_nicks where user_id = ?1 or space_id in (${OWNED})`],
    [
      'limits',
      `delete from limits
        where key in (?1, ?2) or key in (${OWNED})
           or (instr(key, ':') > 0 and substr(key, 1, instr(key, ':') - 1) in (${OWNED}))
           or (instr(key, ':') > 0 and substr(key, 1, instr(key, ':') - 1) = ?1)`,
    ],
    ['cached', "delete from cached where key = ?1 or value = ?1 or value like ?1 || ':%'"],
    ['spaces', 'delete from spaces where user_id = ?1'],
    ['unused_blobs', 'delete from unused_blobs where user_id = ?1'],
    ['blobs', 'delete from blobs where user_id = ?1'],
    ['sessions', 'delete from sessions where user_id = ?1'],
    [
      'feedback_images',
      'delete from feedback_images where feedback_id in (select id from feedback where user_id = ?1)',
    ],
    ['feedback', 'delete from feedback where user_id = ?1'],
    ['mcp_tokens', 'delete from mcp_tokens where user_id = ?1'],
    ['site_icons', 'delete from site_icons where user_id = ?1'],
    ['app_catalogues', 'delete from app_catalogues where user_id = ?1'],
    ['oauth_codes', 'delete from oauth_codes where user_id = ?1'],
    ['oauth_grants', 'delete from oauth_grants where user_id = ?1'],
    ['recovery_codes', 'delete from recovery_codes where user_id = ?1'],
    ['login_codes', 'delete from login_codes where email = ?2'],
    ['mailed', 'delete from mailed where email = ?2'],
    ['mailed_days', 'delete from mailed_days where email = ?2'],
    ['web_keys', 'delete from web_keys where user_id = ?1'],
    ['devices', 'delete from devices where user_id = ?1'],
    ['web_states', 'delete from web_states where user_id = ?1'],
    ['web_chunks', 'delete from web_chunks where user_id = ?1'],
    ['ai_vaults', 'delete from ai_vaults where user_id = ?1'],
    ['ai_devices', 'delete from ai_devices where user_id = ?1'],
    ...hooks().pass.erased,
    ['push_targets', 'delete from push_targets where user_id = ?1'],
    ['push_reminders', 'delete from push_reminders where user_id = ?1'],
    ['time_entries', 'delete from time_entries where user_id = ?1'],
    ['time_cursor', 'delete from time_cursor where user_id = ?1'],
    ['inbox_items', 'delete from inbox_items where user_id = ?1'],
    ['inbox_cursor', 'delete from inbox_cursor where user_id = ?1'],
    ['pad_updates', 'delete from pad_updates where user_id = ?1'],
    [
      'machine_events',
      'delete from machine_events where machine in (select id from machines where user_id = ?1)',
    ],
    ['term_sessions', 'delete from term_sessions where user_id = ?1'],
    ['machine_usage', 'delete from machine_usage where user_id = ?1'],
    ['machines', 'delete from machines where user_id = ?1'],
    ['presence', 'delete from presence where user_id = ?1'],
    ['sync_flips', 'delete from sync_flips where user_id = ?1'],
    ['users', 'delete from users where id = ?1'],
  ]
}

const ROWS_AT_ONCE = 1000

const NOTES_AT_ONCE = 500

const ACCOUNTS_AT_ONCE = 5

const DRAINED: readonly (readonly [table: string, where: string, noted: string | null])[] = [
  [
    'note_versions',
    `note_id in (${OWNED_NOTES})`,
    `select distinct 'versions/' || hash, ?3 from note_versions`,
  ],
  ['note_pictures', `note_id in (${OWNED_NOTES})`, null],
  ['tree_ops', `space_id in (${OWNED})`, null],
  ['space_entries', `space_id in (${OWNED})`, null],
  [
    'web_chunks',
    'user_id = ?1',
    `select 'web/' || user_id || '/chunks/' || name, ?3 from web_chunks`,
  ],
  ['pad_updates', 'user_id = ?1', null],
  ['time_entries', 'user_id = ?1', null],
  ['machine_events', 'machine in (select id from machines where user_id = ?1)', null],
]

const NOTES_NOTED: readonly string[] = [
  `insert or ignore into leftovers (what, since)
     select 'spaces/' || space_id || '/' || id, ?3 from notes where id in (select value from json_each(?2))`,
  `insert or ignore into leftovers (what, since)
     select 'rooms/' || id, ?3 from notes where id in (select value from json_each(?2))`,
  `insert or ignore into leftovers (what, since)
     select 'crdt/' || id, ?3 from notes where id in (select value from json_each(?2))`,
  `insert or ignore into retired_notes (id, since)
     select id, ?3 from notes where id in (select value from json_each(?2))`,
  'delete from notes where id in (select value from json_each(?2))',
]

async function drained(
  env: Env,
  values: readonly unknown[],
  [table, where, noted]: (typeof DRAINED)[number],
): Promise<void> {
  const rows = `select rowid from ${table} where ${where} order by rowid limit ${String(ROWS_AT_ONCE)}`
  for (;;) {
    const results = await env.DB.batch([
      ...(noted
        ? [
            bound(
              env,
              `insert or ignore into leftovers (what, since) ${noted} where rowid in (${rows})`,
              values,
            ),
          ]
        : []),
      bound(env, `delete from ${table} where rowid in (${rows})`, values),
    ])
    if ((results.at(-1)?.meta.changes ?? 0) < ROWS_AT_ONCE) return
  }
}

async function drainedNotes(env: Env, user: User, at: number): Promise<void> {
  for (;;) {
    const { results } = await env.DB.prepare(
      `select id from notes where space_id in (${OWNED}) limit ?2`,
    )
      .bind(user.id, NOTES_AT_ONCE)
      .all<{ id: string }>()
    if (!results.length) return
    const values = [user.id, JSON.stringify(results.map((one) => one.id)), at]
    const answers = await env.DB.batch(NOTES_NOTED.map((sql) => bound(env, sql, values)))
    if (results.length < NOTES_AT_ONCE || !answers.at(-1)?.meta.changes) return
  }
}

export async function finishErasing(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    'select what from leftovers where what like ? order by since, what limit ?',
  )
    .bind(`${ERASING}%`, ACCOUNTS_AT_ONCE)
    .all<{ what: string }>()

  for (const { what } of results) {
    try {
      const user = await env.DB.prepare('select * from users where id = ?')
        .bind(what.slice(ERASING.length))
        .first<User>()
      if (user) await eraseAccount(env, user)
      else await env.DB.prepare('delete from leftovers where what = ?').bind(what).run()
    } catch (error) {
      note('erase', error, null)
      await env.DB.prepare('update leftovers set since = ? where what = ?').bind(now(), what).run()
    }
  }
}

export async function eraseAccount(env: Env, user: User): Promise<void> {
  const at = now()
  const values = [user.id, user.email, at]

  const { results: domains } = await env.DB.prepare(
    'select blog_domain as domain from spaces where user_id = ? and blog_domain is not null',
  )
    .bind(user.id)
    .all<{ domain: string }>()

  const { results: open } = await env.DB.prepare(
    `select note_id, who from room_sockets
      where space_id in (${OWNED}) or who = ?1`,
  )
    .bind(user.id)
    .all<{ note_id: string; who: string }>()

  const { results: chatting } = await env.DB.prepare(
    `select chat_id, who from chat_sockets where chat_id in (${OWNED_CHATS}) or who = ?1`,
  )
    .bind(user.id)
    .all<{ chat_id: string; who: string }>()

  const { results: ending } = await bound(env, THEIR_TERMS_LIVE, values).all<Ended>()

  const handed = await handedOn(env, user, at)

  await env.DB.batch([
    bound(
      env,
      `insert or ignore into leftovers (what, since) values ('${ERASING}' || ?1, ?3)`,
      values,
    ),
    bound(env, 'delete from sessions where user_id = ?1', values),
    bound(env, `update term_sessions set ended_at = ?3 where ${THEIR_TERMS}`, values),
  ])

  for (const each of DRAINED) await drained(env, values, each)
  await drainedNotes(env, user, at)

  await env.DB.batch([
    ...NOTED.map((sql) => bound(env, sql, values)),
    ...handed,
    ...erased().map(([, sql]) => bound(env, sql, values)),
    bound(env, `delete from leftovers where what = '${ERASING}' || ?1`, values),
  ])

  for (const { domain } of domains) await releaseDomain(env, domain)

  try {
    await closeRooms(env, open)
    await hooks().chats.closeChats(env, chatting)
    await hooks().machines.tellEnded(env, ending, null)
    await sweepLeftovers(env)
  } catch (error) {
    note('erase', error, null)
  }

  const receipt = goneMessage()
  await mailer(env).send(user.email, receipt.subject, receipt)
}

function bound(env: Env, sql: string, values: readonly unknown[]): D1PreparedStatement {
  const most = [...sql.matchAll(/\?(\d+)/g)]
    .map((one) => Number(one[1]))
    .reduce((high, one) => Math.max(high, one), 0)
  return env.DB.prepare(sql).bind(...values.slice(0, most))
}

async function handedOn(env: Env, user: User, at: number): Promise<D1PreparedStatement[]> {
  const { results: held } = await env.DB.prepare(
    `select hash, type,
            not exists (select 1 from blobs o where o.hash = b.hash and o.user_id <> ?1) as alone
       from blobs b where user_id = ?1`,
  )
    .bind(user.id)
    .all<{ hash: string; type: string; alone: number }>()
  if (!held.length) return []

  const mine = new Set(held.map((one) => one.hash))
  const pictures = new Set(
    held.filter((one) => one.alone && one.type.startsWith('image/')).map((one) => one.hash),
  )
  const owed = await usedElsewhere(env, user.id, mine)
  await unreadUses(env, user, pictures, owed)

  return handedTo(env, user.id, owed, at)
}
