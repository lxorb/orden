import { Hono } from 'hono'
import {
  INBOX_PAGE,
  inboxChangesOf,
  mergedInbox,
  MOST_INBOX_ITEMS,
  type InboxChange,
  type InboxFields,
  type InboxHeld,
  type InboxItem,
  type InboxPage,
  type InboxStamps,
} from '@orden/sync-core'
import { now } from './crypto'
import { mayChangeTree } from './limits'
import { NOT_AN_OBJECT, TOO_MANY_CHANGES } from './refused'
import { deviceOf } from './sync2/device'
import { keepInboxReminders } from './inbox-text'
import type { Env, Variables } from './types'

const NOT_AN_INBOX_CHANGE = 'that is not a change to the inbox'

const TOO_MANY_ITEMS = 'that is more to-dos than an account’s inbox keeps'

const TRIES = 4

interface Stored {
  id: string
  fields: string
  stamps: string
  seq: number
  at: number
}

const itemOf = (row: Stored): InboxItem => ({
  id: row.id,
  fields: JSON.parse(row.fields) as InboxFields,
  stamps: JSON.parse(row.stamps) as InboxStamps,
  seq: row.seq,
  at: row.at,
})

export async function inboxSince(env: Env, userId: string, since: number): Promise<InboxPage> {
  const { results } = await env.DB.prepare(
    `select id, fields, stamps, seq, at from inbox_items
      where user_id = ? and seq > ? order by seq limit ?`,
  )
    .bind(userId, since, INBOX_PAGE + 1)
    .all<Stored>()

  const page = results.slice(0, INBOX_PAGE)
  return {
    items: page.map(itemOf),
    cursor: page.at(-1)?.seq ?? since,
    more: results.length > INBOX_PAGE,
  }
}

async function heldOf(
  env: Env,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, InboxHeld & { seq: number }>> {
  const { results } = await env.DB.prepare(
    `select id, fields, stamps, seq, at from inbox_items
      where user_id = ?1 and id in (select value from json_each(?2))`,
  )
    .bind(userId, JSON.stringify(ids))
    .all<Stored>()
  return new Map(results.map((row) => [row.id, itemOf(row)]))
}

function roomFor(user: string, sent: string, most: string): string {
  return `((select count(*) from inbox_items where user_id = ${user})
          + (select count(*) from json_each(${sent}) as fresh
              where not exists (select 1 from inbox_items as kept
                                 where kept.user_id = ${user}
                                   and kept.id = json_extract(fresh.value, '$.id'))) <= ${most})`
}

function together(changes: readonly InboxChange[]): InboxChange[] {
  const byId = new Map<string, InboxChange>()
  for (const change of changes) {
    const was = byId.get(change.id)
    if (!was) {
      byId.set(change.id, change)
      continue
    }
    const merged = mergedInbox(was, change)
    byId.set(change.id, { id: change.id, fields: merged.fields, stamps: merged.stamps })
  }
  return [...byId.values()]
}

interface Planned {
  id: string
  fields: string
  stamps: string
  was: number | null
  seq: number
}

async function written(
  env: Env,
  userId: string,
  plans: readonly Planned[],
  by: string,
): Promise<{ last: number; lost: string[] } | 'full'> {
  const many = plans.length
  const sent = JSON.stringify(plans)
  const results = await env.DB.batch([
    env.DB.prepare(`select ${roomFor('?1', '?2', '?3')} as room`).bind(
      userId,
      sent,
      MOST_INBOX_ITEMS,
    ),
    env.DB.prepare(
      `insert into inbox_cursor (user_id, next) select ?1, ?2 + 1
        where ${roomFor('?1', '?3', '?4')}
       on conflict(user_id) do update set next = next + ?2`,
    ).bind(userId, many, sent, MOST_INBOX_ITEMS),
    env.DB.prepare(
      `insert into inbox_items (user_id, id, fields, stamps, seq, at, by)
       select ?1, json_extract(value, '$.id'), json_extract(value, '$.fields'),
              json_extract(value, '$.stamps'),
              (select next from inbox_cursor where user_id = ?1) - ?4
                + json_extract(value, '$.seq'),
              ?5, ?2
         from json_each(?3) where ${roomFor('?1', '?3', '?6')}
       on conflict(user_id, id) do update
         set fields = excluded.fields, stamps = excluded.stamps, seq = excluded.seq,
             at = excluded.at, by = excluded.by
         where inbox_items.seq = (select json_extract(sent.value, '$.was')
                                    from json_each(?3) as sent
                                   where json_extract(sent.value, '$.id') = inbox_items.id)`,
    ).bind(userId, by, sent, many, now(), MOST_INBOX_ITEMS),
    env.DB.prepare(
      `select next - 1 as last,
              (select json_group_array(json_extract(sent.value, '$.id'))
                 from json_each(?2) as sent
                where not exists (
                  select 1 from inbox_items as kept
                   where kept.user_id = ?1 and kept.id = json_extract(sent.value, '$.id')
                     and kept.stamps = json_extract(sent.value, '$.stamps'))) as lost
         from inbox_cursor where user_id = ?1`,
    ).bind(userId, sent),
  ])
  if (!(results[0]?.results[0] as { room?: number } | undefined)?.room) return 'full'
  const row = results.at(-1)?.results[0] as { last?: number; lost?: string } | undefined
  return { last: row?.last ?? many, lost: JSON.parse(row?.lost ?? '[]') as string[] }
}

export async function writeInbox(
  env: Env,
  userId: string,
  sent: readonly InboxChange[],
  by: string,
): Promise<number | 'full'> {
  let changes = together(sent)
  let cursor = 0
  for (let tries = 0; tries < TRIES && changes.length; tries += 1) {
    const held = await heldOf(
      env,
      userId,
      changes.map((one) => one.id),
    )
    const plans: Planned[] = []
    for (const change of changes) {
      const was = held.get(change.id) ?? null
      const merged = mergedInbox(was, change)
      if (!merged.changed) continue
      plans.push({
        id: change.id,
        fields: JSON.stringify(merged.fields),
        stamps: JSON.stringify(merged.stamps),
        was: was?.seq ?? null,
        seq: plans.length,
      })
    }
    if (!plans.length) break
    const done = await written(env, userId, plans, by)
    if (done === 'full') return 'full'
    const { last, lost } = done
    cursor = last
    const again = new Set(lost)
    changes = changes.filter((one) => again.has(one.id))
  }
  return cursor
}

export const inbox = new Hono<{ Bindings: Env; Variables: Variables }>()

inbox.get('/', async (context) => {
  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0
  return context.json(await inboxSince(context.env, context.get('user').id, since))
})

inbox.post('/', async (context) => {
  const body: unknown = await context.req.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null) return context.json({ error: NOT_AN_OBJECT }, 400)
  const changes = inboxChangesOf(body)
  if (!changes) return context.json({ error: NOT_AN_INBOX_CHANGE }, 400)

  const user = context.get('user').id
  if (!changes.length) return context.json({ cursor: 0 })
  if (!(await mayChangeTree(context.env, user))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }
  const cursor = await writeInbox(context.env, user, changes, await deviceOf(context))
  if (cursor === 'full') return context.json({ error: TOO_MANY_ITEMS }, 413)
  await keepInboxReminders(context.env, user).catch(() => undefined)
  return context.json({ cursor })
})
