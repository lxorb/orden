import { Hono } from 'hono'
import * as Y from 'yjs'
import { MOST_PAD_BYTES, padBase64, padBytes, padTradeOf, padWire } from '@orden/sync-core/pad'
import { now } from './crypto'
import { mayPushDocuments } from './limits'
import { NOT_AN_OBJECT, TOO_MANY_CHANGES } from './refused'
import { deviceOf } from './sync2/device'
import type { Env, Variables } from './types'

const NOT_A_PAD_CHANGE = 'that is not a change to the scratchpad'

const TOO_LARGE = 'that makes the scratchpad larger than an account keeps'

const MOST_ROWS = 16

interface Held {
  doc: Y.Doc
  last: number
  rows: number
}

async function held(env: Env, userId: string): Promise<Held> {
  const { results } = await env.DB.prepare(
    'select seq, body from pad_updates where user_id = ? order by seq',
  )
    .bind(userId)
    .all<{ seq: number; body: string }>()

  const doc = new Y.Doc()
  for (const row of results) {
    const bytes = padBytes(row.body)
    if (bytes) Y.applyUpdateV2(doc, bytes)
  }
  return { doc, last: results.at(-1)?.seq ?? 0, rows: results.length }
}

function taken(doc: Y.Doc, update: Uint8Array): Uint8Array[] | null {
  const fresh: Uint8Array[] = []
  const heard = (one: Uint8Array) => fresh.push(one)
  doc.on('updateV2', heard)
  try {
    if (update.length) Y.applyUpdateV2(doc, update)
    return fresh
  } catch {
    return null
  } finally {
    doc.off('updateV2', heard)
  }
}

function diffed(doc: Y.Doc, sv: Uint8Array): Uint8Array | null {
  try {
    return Y.encodeStateAsUpdateV2(doc, sv)
  } catch {
    return null
  }
}

async function kept(env: Env, userId: string, by: string, was: Held, fresh: Uint8Array[]) {
  const at = now()
  const insert = (body: Uint8Array) =>
    env.DB.prepare('insert into pad_updates (user_id, body, at, by) values (?, ?, ?, ?)').bind(
      userId,
      padBase64(body),
      at,
      by,
    )

  if (was.rows + 1 < MOST_ROWS) {
    await insert(Y.mergeUpdatesV2(fresh)).run()
    return
  }
  await env.DB.batch([
    insert(Y.encodeStateAsUpdateV2(was.doc)),
    env.DB.prepare('delete from pad_updates where user_id = ? and seq <= ?').bind(userId, was.last),
  ])
}

export const pad = new Hono<{ Bindings: Env; Variables: Variables }>()

pad.post('/', async (context) => {
  const body: unknown = await context.req.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null) return context.json({ error: NOT_AN_OBJECT }, 400)
  const trade = padTradeOf(body)
  if (!trade) return context.json({ error: NOT_A_PAD_CHANGE }, 400)
  if (trade.update.length > MOST_PAD_BYTES) return context.json({ error: TOO_LARGE }, 413)

  const user = context.get('user').id
  const was = await held(context.env, user)
  const fresh = taken(was.doc, trade.update)
  const update = fresh && diffed(was.doc, trade.sv)
  if (!fresh || !update) return context.json({ error: NOT_A_PAD_CHANGE }, 400)

  if (fresh.length) {
    if (Y.encodeStateAsUpdateV2(was.doc).length > MOST_PAD_BYTES) {
      return context.json({ error: TOO_LARGE }, 413)
    }
    if (!(await mayPushDocuments(context.env, user))) {
      return context.json({ error: TOO_MANY_CHANGES }, 429)
    }
    await kept(context.env, user, await deviceOf(context), was, fresh)
  }

  return context.json(padWire({ update, sv: Y.encodeStateVector(was.doc) }))
})
