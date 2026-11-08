import { Hono } from 'hono'
import {
  MOST_TIME_ENTRIES,
  TIME_PAGE,
  timeChangesOf,
  type TimeChange,
  type TimeEntry,
  type TimePage,
} from '@orden/sync-core/time'
import { now } from './crypto'
import { mayChangeTree } from './limits'
import { NOT_AN_OBJECT, TOO_MANY_CHANGES } from './refused'
import { deviceOf } from './sync2/device'
import type { Env, Variables } from './types'

const NOT_A_TIME_RECORD = 'that is not a time record'

const TOO_MUCH_TIME = 'that is more time records than an account keeps'

async function entriesSince(env: Env, userId: string, since: number): Promise<TimePage> {
  const { results } = await env.DB.prepare(
    `select kind, id, value, seq, at from time_entries
      where user_id = ? and seq > ? order by seq limit ?`,
  )
    .bind(userId, since, TIME_PAGE + 1)
    .all<{ kind: string; id: string; value: string | null; seq: number; at: number }>()

  const page = results.slice(0, TIME_PAGE)
  return {
    entries: page.map((row): TimeEntry => ({
      kind: row.kind,
      id: row.id,
      value: row.value === null ? null : (JSON.parse(row.value) as Record<string, unknown>),
      seq: row.seq,
      at: row.at,
    })),
    cursor: page.at(-1)?.seq ?? since,
    more: results.length > TIME_PAGE,
  }
}

function roomFor(user: string, sent: string, most: string): string {
  return `((select count(*) from time_entries where user_id = ${user})
          + (select count(*) from (select distinct json_extract(value, '$.kind') as kind,
                                                   json_extract(value, '$.id') as id
                                     from json_each(${sent})) as fresh
              where not exists (select 1 from time_entries as kept
                                 where kept.user_id = ${user}
                                   and kept.kind = fresh.kind and kept.id = fresh.id)) <= ${most})`
}

async function written(
  env: Env,
  userId: string,
  changes: readonly TimeChange[],
  by: string,
): Promise<number | 'full'> {
  const many = changes.length
  const at = now()
  const rows = changes.map((one, index) => ({
    kind: one.kind,
    id: one.id,
    value: one.value === null ? null : JSON.stringify(one.value),
    seq: index,
  }))
  const sent = JSON.stringify(rows)
  const results = await env.DB.batch([
    env.DB.prepare(`select ${roomFor('?1', '?2', '?3')} as room`).bind(
      userId,
      sent,
      MOST_TIME_ENTRIES,
    ),
    env.DB.prepare(
      `insert into time_cursor (user_id, next) select ?1, ?2 + 1
        where ${roomFor('?1', '?3', '?4')}
       on conflict(user_id) do update set next = next + ?2`,
    ).bind(userId, many, sent, MOST_TIME_ENTRIES),
    env.DB.prepare(
      `insert into time_entries (user_id, kind, id, value, seq, at, by)
       select ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'),
              json_extract(value, '$.value'),
              (select next from time_cursor where user_id = ?1) - ?4
                + json_extract(value, '$.seq'),
              ?5, ?2
         from json_each(?3) where ${roomFor('?1', '?3', '?6')}
       on conflict(user_id, kind, id) do update
         set value = excluded.value, seq = excluded.seq, at = excluded.at, by = excluded.by`,
    ).bind(userId, by, sent, many, at, MOST_TIME_ENTRIES),
    env.DB.prepare('select next - 1 as last from time_cursor where user_id = ?1').bind(userId),
  ])
  if (!(results[0]?.results[0] as { room?: number } | undefined)?.room) return 'full'
  return (results.at(-1)?.results[0] as { last?: number } | undefined)?.last ?? many
}

export const time = new Hono<{ Bindings: Env; Variables: Variables }>()

time.get('/', async (context) => {
  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0
  return context.json(await entriesSince(context.env, context.get('user').id, since))
})

time.post('/', async (context) => {
  const body: unknown = await context.req.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null) return context.json({ error: NOT_AN_OBJECT }, 400)
  const changes = timeChangesOf(body)
  if (!changes) return context.json({ error: NOT_A_TIME_RECORD }, 400)

  const user = context.get('user').id
  if (!changes.length) return context.json({ cursor: 0 })
  if (!(await mayChangeTree(context.env, user))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }
  const cursor = await written(context.env, user, changes, await deviceOf(context))
  if (cursor === 'full') return context.json({ error: TOO_MUCH_TIME }, 413)
  return context.json({ cursor })
})
