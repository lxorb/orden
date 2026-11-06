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

async function fits(env: Env, userId: string, changes: readonly TimeChange[]): Promise<boolean> {
  const keys = new Map(changes.map(({ kind, id }) => [`${kind}\u0000${id}`, { kind, id }]))
  const sent = [...keys.values()]
  const row = await env.DB.prepare(
    `select count(*) as held,
            (select count(*) from time_entries as kept, json_each(?2) as sent
              where kept.user_id = ?1
                and kept.kind = json_extract(sent.value, '$.kind')
                and kept.id = json_extract(sent.value, '$.id')) as known
       from time_entries where user_id = ?1`,
  )
    .bind(userId, JSON.stringify(sent))
    .first<{ held: number; known: number }>()
  return (row?.held ?? 0) + sent.length - (row?.known ?? 0) <= MOST_TIME_ENTRIES
}

async function written(
  env: Env,
  userId: string,
  changes: readonly TimeChange[],
  by: string,
): Promise<number> {
  const many = changes.length
  const at = now()
  const rows = changes.map((one, index) => ({
    kind: one.kind,
    id: one.id,
    value: one.value === null ? null : JSON.stringify(one.value),
    seq: index,
  }))
  const results = await env.DB.batch([
    env.DB.prepare(
      `insert into time_cursor (user_id, next) values (?1, ?2 + 1)
       on conflict(user_id) do update set next = next + ?2`,
    ).bind(userId, many),
    env.DB.prepare(
      `insert into time_entries (user_id, kind, id, value, seq, at, by)
       select ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'),
              json_extract(value, '$.value'),
              (select next from time_cursor where user_id = ?1) - ?4
                + json_extract(value, '$.seq'),
              ?5, ?2
         from json_each(?3) where true
       on conflict(user_id, kind, id) do update
         set value = excluded.value, seq = excluded.seq, at = excluded.at, by = excluded.by`,
    ).bind(userId, by, JSON.stringify(rows), many, at),
    env.DB.prepare('select next - 1 as last from time_cursor where user_id = ?1').bind(userId),
  ])
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
  if (!(await fits(context.env, user, changes))) return context.json({ error: TOO_MUCH_TIME }, 413)

  const cursor = await written(context.env, user, changes, await deviceOf(context))
  return context.json({ cursor })
})
