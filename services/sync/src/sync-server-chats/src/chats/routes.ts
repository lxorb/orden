import { type Event, type Message, matches, parseSearch, type Who } from '@orden/chats'
import { EVENTS_A_MINUTE, LONGEST_SEARCH } from '@orden/chats/limits'
import { newChatOf, postEventsOf } from '@orden/chats/wire'
import { Hono } from 'hono'
import {
  newId,
  now,
  within,
  NO_SUCH_SPACE,
  MOST_MEMBERS,
  roomForAnItem,
  roomForItem,
  roomForMember,
  TOO_MANY_ITEMS,
  allows,
  MOST_ITEMS,
  onceShared,
  reachedSpace,
  refusal,
  blobKey,
  BYTES,
  NO_SUCH_FILE,
  deviceOf,
  type Env,
  type Variables,
  type Whoever,
} from '../../../sync-server/src/api'
import { askChat, CHAT_AWAY, chatsMoved } from './ask'
import { INVALID, RATE } from './placing'
import { askingOf, reachChat, type Reached } from './reach'

interface App {
  Bindings: Env
  Variables: Variables
}

export const NO_SUCH_CHAT = 'no such chat'

const NOT_THAT = 'that is not what this route reads'

const MOST_SEARCHED = 50

const MOST_HITS = 100

const HASH = /^[a-f0-9]{64}$/

export const chats = new Hono<App>()

export function asking(reached: Reached, device?: string): Record<string, string> {
  return {
    'x-orden-space': reached.space,
    'x-orden-who': reached.id,
    'x-orden-guest': reached.guest ? 'yes' : 'no',
    'x-orden-role': reached.role,
    ...(device ? { 'x-orden-device': device.slice(0, 200) } : {}),
  }
}

function passed(answer: Response | null): Response {
  return (
    answer ?? Response.json({ error: CHAT_AWAY }, { status: 503, headers: { 'retry-after': '1' } })
  )
}

const LISTED = `with me as (select ?1 as user_id, ?2 as email, ?3 as guest_id),
held as (
  select sp.id as space_id, '' as item, 'owner' as role
    from me join spaces sp on sp.user_id = me.user_id and sp.deleted = 0
  union all
  select m.space_id, m.item, m.role
    from me join space_members m on m.email = me.email
    join spaces sp on sp.id = m.space_id and sp.deleted = 0
  union all
  select g.space_id, g.item, g.role
    from me join guest_members g on g.guest_id = me.guest_id and g.joined_at is not null
    join spaces sp on sp.id = g.space_id and sp.deleted = 0
),
found as (
  select ch.id as id, h.role as role from held h join chats ch on ch.space_id = h.space_id
   where h.item = ''
  union all
  select ch.id, h.role from held h
    join chats ch on ch.file_id = h.item and ch.space_id = h.space_id
    join notes f on f.id = ch.file_id and f.deleted = 0
   where h.item <> ''
)
select ch.id as id, ch.space_id as space,
       max(case f.role when 'owner' then 3 when 'write' then 2 else 1 end) as rank,
       (select count(*) from (
          select sp.user_id from spaces sp where sp.id = ch.space_id
          union select u.id from space_members m join users u on u.email = m.email
           where m.space_id = ch.space_id and (m.item = '' or m.item = ch.file_id)
          union select g.guest_id from guest_members g
           where g.space_id = ch.space_id and (g.item = '' or g.item = ch.file_id)
             and g.joined_at is not null)) as members,
       ch.last_seq as last_seq, ch.last_at as last_at, ch.last_by as last_by,
       ch.topic as topic, ch.posting as posting, ch.slowmode as slowmode,
       coalesce(r.read_seq, 0) as read_seq, coalesce(r.mentions, 0) as mentions,
       r.notify as notify, r.muted_until as muted_until
  from found f join chats ch on ch.id = f.id
  left join chat_reads r on r.chat_id = ch.id
                        and r.who = (select coalesce(user_id, guest_id) from me)
 where ch.ended_at is null and (?4 is null or ch.space_id = ?4)
   -- Its pointer in Recently deleted: the chat is not listed while it is there, and is
   -- again once it is put back (#375). Still reached by id, so a pointer restored opens
   -- the chat as it was.
   and not exists (select 1 from notes n where n.id = ch.file_id and n.deleted = 1)
 group by ch.id
 order by coalesce(ch.last_at, ch.created_at) desc
 limit ?5`

interface ListedRow {
  id: string
  space: string
  rank: number
  members: number
  last_seq: number
  last_at: number | null
  last_by: string | null
  topic: string
  posting: string
  slowmode: number
  read_seq: number
  mentions: number
  notify: string | null
  muted_until: number | null
}

const ROLES = ['read', 'read', 'write', 'owner'] as const

function rowOf(row: ListedRow) {
  return {
    id: row.id,
    space: row.space,
    role: ROLES[row.rank] ?? 'read',
    members: row.members,
    lastSeq: row.last_seq,
    lastAt: row.last_at,
    lastBy: row.last_by,
    readSeq: row.read_seq,
    mentions: row.mentions,
    notify: row.notify,
    mutedUntil: row.muted_until,
    meta: {
      topic: row.topic,
      posting: row.posting === 'owner' ? 'owner' : 'writers',
      slowmode: row.slowmode,
    },
  }
}

export async function listed(
  env: Env,
  who: Whoever,
  space: string | null,
  most: number | null = 2000,
) {
  const { results } = await env.DB.prepare(LISTED)
    .bind(...askingOf(who), space, most ?? -1)
    .all<ListedRow>()
  return results.map(rowOf)
}

chats.get('/', async (context) => {
  const space = context.req.query('space') ?? null
  return context.json({ chats: await listed(context.env, context.get('who'), space) })
})

chats.post('/', async (context) => {
  const env = context.env
  const asked = newChatOf(await context.req.json().catch(() => null))
  if (!asked) return context.json({ error: NOT_THAT }, 400)

  const space = await reachedSpace(env, context.get('who'), asked.space)
  if (!space) return context.json({ error: NO_SUCH_SPACE }, 404)
  if (!allows(space.role, 'write')) return context.json({ error: refusal('write') }, 403)

  const chat = `c_${newId().replaceAll('-', '')}`
  await env.DB.prepare('insert into chats (id, space_id, created_at) values (?, ?, ?)')
    .bind(chat, space.id, now())
    .run()
  return context.json({ v: 1, chat }, 201)
})

chats.patch('/:chat', async (context) => {
  const env = context.env
  const reached = await reachChat(env, context.get('who'), context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!sent) return context.json({ error: NOT_THAT }, 400)

  if (typeof sent.space === 'string') {
    const source = await reachedSpace(env, context.get('who'), reached.space)
    if (!source || !allows(source.role, 'write')) {
      return context.json({ error: 'this chat was shared with you, not its space' }, 403)
    }
    const target = await reachedSpace(env, context.get('who'), sent.space)
    if (!target) return context.json({ error: NO_SUCH_SPACE }, 404)
    if (!allows(target.role, 'write')) return context.json({ error: refusal('write') }, 403)
    if (source.role !== 'owner' && target.user_id !== source.user_id) {
      return context.json({ error: refusal('owner') }, 403)
    }
    await chatsMoved(env, reached.chat, target.id)
    return context.json({ space: target.id })
  }

  const meta: Event = { kind: 'meta', id: `m_${newId().replaceAll('-', '')}` }
  for (const key of ['topic', 'posting', 'slowmode'] as const) {
    if (sent[key] !== undefined) Object.assign(meta, { [key]: sent[key] })
  }
  const checked = postEventsOf({ events: [meta] })
  if (!checked) return context.json({ error: NOT_THAT }, 400)
  const answer = await askChat(
    env,
    reached.chat,
    'send',
    asking(reached, await deviceOf(context)),
    {
      body: JSON.stringify(checked),
    },
  )
  if (!answer) return passed(null)
  const { results } = await answer.json<{ results: { refused?: string }[] }>()
  const refused = results[0]?.refused
  return refused ? context.json({ error: refused }, 403) : context.json({ ok: true })
})

function reachedOf(context: { env: Env; get: (key: 'who') => Variables['who'] }, chat: string) {
  return reachChat(context.env, context.get('who'), chat)
}

chats.get('/:chat/events', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(
    await askChat(context.env, reached.chat, 'events', asking(reached), { url: context.req.url }),
  )
})

chats.get('/:chat/state', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(
    await askChat(context.env, reached.chat, 'state', asking(reached), { url: context.req.url }),
  )
})

chats.post('/:chat/events', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)

  const sent = postEventsOf(await context.req.json().catch(() => null))
  if (!sent) return context.json({ error: INVALID }, 400)
  if (!(await within(env, 'chat-events', reached.id, EVENTS_A_MINUTE, 60_000))) {
    return context.json({ error: RATE }, 429)
  }
  return passed(
    await askChat(env, reached.chat, 'send', asking(reached, await deviceOf(context)), {
      body: JSON.stringify(sent),
    }),
  )
})

chats.post('/:chat/read', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as {
    seq?: unknown
    back?: unknown
  } | null
  const seq = sent?.seq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return context.json({ error: NOT_THAT }, 400)
  }
  return passed(
    await askChat(context.env, reached.chat, 'read', asking(reached), {
      body: JSON.stringify({ seq, back: sent?.back === true }),
    }),
  )
})

chats.get('/:chat/scheduled', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(await askChat(context.env, reached.chat, 'scheduled', asking(reached)))
})

const NOTIFY = new Set(['all', 'mentions', 'nothing'])

chats.put('/:chat/me', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  const notify = sent?.notify
  const until = sent?.mutedUntil
  const notifyOk =
    notify === undefined || notify === null || (typeof notify === 'string' && NOTIFY.has(notify))
  const untilOk =
    until === undefined ||
    until === null ||
    (typeof until === 'number' && Number.isSafeInteger(until))
  if (!sent || !notifyOk || !untilOk) return context.json({ error: NOT_THAT }, 400)

  const row = await context.env.DB.prepare(
    `insert into chat_reads (chat_id, who, notify, muted_until) values (?1, ?2, ?3, ?4)
     on conflict(chat_id, who) do update set
       notify = case when ?5 then excluded.notify else chat_reads.notify end,
       muted_until = case when ?6 then excluded.muted_until else chat_reads.muted_until end
     returning notify, muted_until`,
  )
    .bind(
      reached.chat,
      reached.id,
      typeof notify === 'string' ? notify : null,
      typeof until === 'number' ? until : null,
      notify === undefined ? 0 : 1,
      until === undefined ? 0 : 1,
    )
    .first<{ notify: string | null; muted_until: number | null }>()
  return context.json({ notify: row?.notify ?? null, mutedUntil: row?.muted_until ?? null })
})

const MEMBERS = `with c as (
  select sp.id as space_id, sp.user_id as owner, f.id as file_id
    from chats ch join spaces sp on sp.id = ch.space_id
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
   where ch.id = ?1
),
people as (
  select owner as id, 0 as guest, 3 as rank from c
  union all
  select u.id, 0, case m.role when 'write' then 2 else 1 end
    from c join space_members m on m.space_id = c.space_id and (m.item = '' or m.item = c.file_id)
    join users u on u.email = m.email
  union all
  select g.guest_id, 1, case g.role when 'write' then 2 else 1 end
    from c join guest_members g on g.space_id = c.space_id
                               and (g.item = '' or g.item = c.file_id) and g.joined_at is not null
)
select p.id as id, p.guest as guest, max(p.rank) as rank,
       case when p.guest = 1 then (select name from guests where id = p.id)
            else (select name from users where id = p.id) end as name
  from people p group by p.id, p.guest order by rank desc, name
  limit 500`

interface Member {
  who: Who
  name: string | null
  role: (typeof ROLES)[number]
}

export async function membersOf(env: Env, chat: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(MEMBERS)
    .bind(chat)
    .all<{ id: string; guest: number; rank: number; name: string | null }>()
  return results.map((one) => ({
    who: one.guest === 1 ? `guest:${one.id}` : `user:${one.id}`,
    name: one.name,
    role: ROLES[one.rank] ?? 'read',
  }))
}

chats.get('/:chat/members', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return context.json({ members: await membersOf(context.env, reached.chat) })
})

const MISSING = `with c as (
  select sp.id as space_id, sp.user_id as owner, f.id as file_id
    from chats ch join spaces sp on sp.id = ch.space_id
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
   where ch.id = ?1 and ch.ended_at is null
),
people as (
  select owner as id from c
  union select u.id from c
    join space_members m on m.space_id = c.space_id and (m.item = '' or m.item = c.file_id)
    join users u on u.email = m.email
)
select u.id as id, u.email as email, u.name as name
  from people p join users u on u.id = p.id
 where u.id <> (select user_id from spaces where id = ?2)
   and not exists (select 1 from space_members m where m.space_id = ?2 and m.email = u.email
                     and (m.item = '' or m.item = ?3))
 order by u.name limit 200`

async function droppedNote(
  env: Env,
  who: Whoever,
  space: unknown,
  note: unknown,
): Promise<{ space: string; note: string; owner: boolean } | null> {
  if (typeof space !== 'string' || typeof note !== 'string') return null
  const reached = await reachedSpace(env, who, space)
  if (!reached) return null
  const found = await env.DB.prepare(
    'select id from notes where id = ? and space_id = ? and deleted = 0',
  )
    .bind(note, space)
    .first<{ id: string }>()
  return found ? { space, note, owner: reached.role === 'owner' } : null
}

chats.get('/:chat/note', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const dropped = await droppedNote(
    env,
    context.get('who'),
    context.req.query('space'),
    context.req.query('note'),
  )
  if (!dropped) return context.json({ error: NO_SUCH_SPACE }, 404)
  const { results } = await env.DB.prepare(MISSING)
    .bind(reached.chat, dropped.space, dropped.note)
    .all<{ id: string; name: string | null }>()
  return context.json({
    missing: results.map((one) => ({ who: `user:${one.id}`, name: one.name })),
    share: dropped.owner,
  })
})

chats.post('/:chat/note', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  const dropped = await droppedNote(env, context.get('who'), sent?.space, sent?.note)
  if (!dropped) return context.json({ error: NO_SUCH_SPACE }, 404)
  if (!dropped.owner) return context.json({ error: refusal('owner') }, 403)
  if (!(await roomForAnItem(env, dropped.space, dropped.note))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }
  const { results } = await env.DB.prepare(MISSING)
    .bind(reached.chat, dropped.space, dropped.note)
    .all<{ email: string }>()
  const at = now()
  let shared = 0
  for (const one of results) {
    const added = await env.DB.prepare(
      `insert into space_members (space_id, email, item, role, joined_at, created_at)
       select ?1, ?2, ?3, 'read', ?4, ?4
        where ${roomForMember('?1', '?2', '?3', '?5')} and ${roomForItem('?1', '?3', '?6')}
       on conflict(space_id, email, item) do nothing`,
    )
      .bind(dropped.space, one.email, dropped.note, at, MOST_MEMBERS, MOST_ITEMS)
      .run()
    shared += added.meta.changes
  }
  if (!shared && results.length && !(await roomForAnItem(env, dropped.space, dropped.note))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }
  if (shared) await onceShared(env, dropped.space, dropped.note)
  return context.json({ shared })
})

function dayIn(zone: string | undefined): (at: number) => string {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'UTC' })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' })
  }
  return (at) => format.format(new Date(at))
}

export async function searched(
  env: Env,
  who: Whoever,
  query: (name: string) => string | undefined,
  picked: readonly { id: string; reached: Reached }[],
): Promise<{ chat: string; message: Message }[]> {
  const dayOf = dayIn(query('zone'))
  const said = query('q') ?? ''
  if (said.length > LONGEST_SEARCH) return []
  const asked = parseSearch(said, query('today') ?? dayOf(Date.now()))
  const me: Who = who.kind === 'user' ? `user:${who.user.id}` : `guest:${who.guest.id}`
  const words = [...asked.words, ...asked.phrases]

  const found = await Promise.all(
    picked.map(async ({ id, reached }) => {
      const answer = await askChat(env, id, 'search', asking(reached), {
        body: JSON.stringify({ words }),
      })
      if (!answer?.ok) return []
      const { messages } = await answer.json<{ messages: Message[] }>()
      const names = new Map((await membersOf(env, id)).map((one) => [one.who, one.name ?? '']))
      const name = await chatName(env, id)
      return messages
        .filter((message) =>
          matches(asked, {
            message,
            chat: name,
            me,
            namesOf: (person) => [names.get(person) ?? ''].filter(Boolean),
            dayOf,
          }),
        )
        .map((message) => ({ chat: id, message }))
    }),
  )
  return found
    .flat()
    .sort((a, b) => b.message.at - a.message.at)
    .slice(0, MOST_HITS)
}

async function chatName(env: Env, chat: string): Promise<string> {
  const row = await env.DB.prepare(
    'select f.path as path from chats ch join notes f on f.id = ch.file_id where ch.id = ?',
  )
    .bind(chat)
    .first<{ path: string }>()
  return (row?.path.split('/').pop() ?? '').replace(/\.chat$/i, '')
}

chats.get('/search', async (context) => {
  const who = context.get('who')
  const all = await listed(context.env, who, null)
  const reachedAll = await Promise.all(
    all.slice(0, MOST_SEARCHED).map(async (one) => ({
      id: one.id,
      reached: await reachChat(context.env, who, one.id),
    })),
  )
  const picked = reachedAll.flatMap((one) =>
    one.reached ? [{ id: one.id, reached: one.reached }] : [],
  )
  const hits = await searched(context.env, who, context.req.query.bind(context.req), picked)
  return context.json({ hits })
})

chats.get('/:chat/search', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const hits = await searched(
    context.env,
    context.get('who'),
    context.req.query.bind(context.req),
    [{ id: reached.chat, reached }],
  )
  return context.json({ hits: hits.map((one) => one.message) })
})

chats.get('/:chat/files/:hash', async (context) => {
  const env = context.env
  const hash = context.req.param('hash').toLowerCase()
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)

  const named = HASH.test(hash)
    ? await env.DB.prepare('select 1 as yes from chat_files where chat_id = ? and hash = ?')
        .bind(reached.chat, hash)
        .first<{ yes: number }>()
    : null
  const object = named ? await env.NOTES.get(blobKey(hash)) : null
  if (!object) return context.json({ error: NO_SUCH_FILE }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': BYTES,
      'content-length': String(object.size),
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})
