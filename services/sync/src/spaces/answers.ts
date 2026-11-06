import { Hono } from 'hono'
import { objectIn } from '../body'
import { asCsv } from '../blog/form'
import { newId } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

const MOST_SHOWN = 500

const MOST_ANSWERS = 5000
const MOST_ANSWER_BYTES = 10 * 1024 * 1024

const KEPT_DAYS = 180

const A_DAY = 24 * 60 * 60 * 1000

export async function keepAnswer(
  env: Env,
  spaceId: string,
  noteId: string,
  answers: Record<string, string>,
): Promise<boolean> {
  const text = JSON.stringify(answers)
  const bytes = new TextEncoder().encode(text).byteLength

  const kept = await env.DB.prepare(
    `insert into form_answers (id, space_id, note_id, at, answers, bytes)
     select ?1, ?2, ?3, ?4, ?5, ?6
      where (select count(*) from form_answers where space_id = ?2) < ?7
        and (select coalesce(sum(bytes), 0) from form_answers where space_id = ?2) + ?6 <= ?8`,
  )
    .bind(newId(), spaceId, noteId, Date.now(), text, bytes, MOST_ANSWERS, MOST_ANSWER_BYTES)
    .run()

  return kept.meta.changes > 0
}

async function isFull(env: Env, spaceId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select count(*) as many, coalesce(sum(bytes), 0) as bytes
       from form_answers where space_id = ?`,
  )
    .bind(spaceId)
    .first<{ many: number; bytes: number }>()

  return (held?.many ?? 0) >= MOST_ANSWERS || (held?.bytes ?? 0) >= MOST_ANSWER_BYTES
}

export function sweepAnswers(env: Env, at: number): Promise<unknown> {
  return env.DB.prepare('delete from form_answers where at < ?')
    .bind(at - KEPT_DAYS * A_DAY)
    .run()
}

interface Row {
  id: string
  note_id: string
  path: string
  at: number
  answers: string
}

function present(row: Row) {
  const held = objectIn(row.answers)
  const answers: Record<string, string> = Object.fromEntries(
    Object.entries(held ?? {}).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  )
  return { id: row.id, note: row.note_id, path: row.path, at: row.at, answers }
}

async function rowsFor(env: Env, spaceId: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `select a.id as id, a.note_id as note_id, n.path as path, a.at as at, a.answers as answers
       from form_answers a
       join notes n on n.id = a.note_id
      where a.space_id = ?
      order by a.at desc
      limit ?`,
  )
    .bind(spaceId, MOST_SHOWN)
    .all<Row>()

  return results
}

export const answers = new Hono<{ Bindings: Env; Variables: Variables }>()

answers.get('/:id/answers', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  return context.json({
    answers: rows.map(present),
    more: rows.length === MOST_SHOWN,
    keptDays: KEPT_DAYS,
    full: await isFull(context.env, space.id),
  })
})

answers.get('/:id/answers.csv', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  const csv = asCsv(rows.map(present))

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="answers.csv"',
      'cache-control': 'private, no-store',
    },
  })
})

answers.delete('/:id/answers/:answer', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await context.env.DB.prepare('delete from form_answers where id = ? and space_id = ?')
    .bind(context.req.param('answer'), space.id)
    .run()

  return context.json({ ok: true })
})
