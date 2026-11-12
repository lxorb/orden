import { MOST_FILE_PARTS, MOST_SEALED_PART } from '@orden/pass/file-sizes'
import { isPassId } from '@orden/pass/wire'
import { Hono } from 'hono'
import { now, OUT_OF_SPACE, fits, type Env, type Variables } from '../../sync-server/src/api'
import { activeIn, holdsSql, mayAct } from './access'
import {
  NO_SUCH_FILE,
  NO_SUCH_ITEM,
  NO_SUCH_VAULT,
  NOT_A_FILE,
  NOT_YOUR_ROLE,
  TAKEN,
} from './refusals'

export const files = new Hono<{ Bindings: Env; Variables: Variables }>()

const TOO_BIG = 'that part of the file is too big'
const SAY_THE_LENGTH = 'say how long the part is'

const OBJECT = `'pass/files/' || item_id || '/' || file_id || '/' || part`

function fileObject(item: string, file: string, part: number): string {
  return `pass/files/${item}/${file}/${String(part)}`
}

export function filesGone(
  db: D1Database,
  where: string,
  values: readonly unknown[],
): D1PreparedStatement[] {
  const at = `?${String(values.length + 1)}`
  return [
    db
      .prepare(
        `insert or ignore into leftovers (what, since)
         select ${OBJECT}, ${at} from pass_file_parts where ${where}`,
      )
      .bind(...values, now()),
    db.prepare(`delete from pass_file_parts where ${where}`).bind(...values),
  ]
}

export const ITEM_FILES_GONE = `vault_id = ?1 and item_id = ?2
  and exists (select 1 from pass_items where vault_id = ?1 and id = ?2 and deleted_at is not null)`

function countIn(text: string | undefined, fallback: number | null): number | null {
  if (text === undefined) return fallback
  if (!/^\d{1,3}$/.test(text)) return null
  return Number(text)
}

interface PartDb {
  part: number
  parts: number
  vault_id: string
  user_id: string
  size: number
}

async function partsOf(env: Env, item: string, file: string): Promise<PartDb[]> {
  const { results } = await env.DB.prepare(
    `select part, parts, vault_id, user_id, size from pass_file_parts
      where item_id = ? and file_id = ? order by part`,
  )
    .bind(item, file)
    .all<PartDb>()
  return results
}

function idsOf(context: { req: { param(name: string): string | undefined } }) {
  const vault = context.req.param('vault') ?? ''
  const item = context.req.param('item') ?? ''
  const file = context.req.param('file') ?? ''
  return { vault, item, file, ok: isPassId(vault) && isPassId(item) && isPassId(file) }
}

files.put('/files/:vault/:item/:file', async (context) => {
  const user = context.get('user')
  const { vault, item, file, ok } = idsOf(context)
  const part = countIn(context.req.query('part'), 0)
  const parts = countIn(context.req.query('parts'), 1)
  if (!ok || part === null || parts === null || parts < 1 || parts > MOST_FILE_PARTS) {
    return context.json({ error: NOT_A_FILE }, 400)
  }
  if (part >= parts) return context.json({ error: NOT_A_FILE }, 400)
  const declared = context.req.header('content-length')
  if (declared === undefined || !/^\d+$/.test(declared)) {
    return context.json({ error: SAY_THE_LENGTH }, 411)
  }
  if (Number(declared) > MOST_SEALED_PART) return context.json({ error: TOO_BIG }, 413)

  const held = await activeIn(context.env, vault, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  const alive = await context.env.DB.prepare(
    'select 1 from pass_items where vault_id = ? and id = ? and deleted_at is null',
  )
    .bind(vault, item)
    .first()
  if (!alive) return context.json({ error: NO_SUCH_ITEM }, 404)

  const known = await partsOf(context.env, item, file)
  if (known.some((one) => one.vault_id !== vault)) return context.json({ error: TAKEN }, 409)
  if (known.some((one) => one.parts !== parts)) return context.json({ error: NOT_A_FILE }, 409)

  const body = await context.req.arrayBuffer()
  if (!body.byteLength) return context.json({ error: NOT_A_FILE }, 400)
  if (body.byteLength > MOST_SEALED_PART) return context.json({ error: TOO_BIG }, 413)

  const before = known.find((one) => one.part === part)
  const replacing = before?.user_id === user.id ? before.size : 0
  if (!(await fits(context.env, user.id, body.byteLength, replacing))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const claimed = await context.env.DB.prepare(
    `insert into pass_file_parts (item_id, file_id, part, parts, vault_id, user_id, size, at)
     select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      where not exists (select 1 from pass_file_parts
                         where item_id = ?1 and file_id = ?2 and (vault_id <> ?5 or parts <> ?4))
        and exists (select 1 from pass_items where vault_id = ?5 and id = ?1 and deleted_at is null)
        and ${holdsSql('?5', '?9', 'editor')}
     on conflict(item_id, file_id, part) do update set
       user_id = excluded.user_id, size = excluded.size, at = excluded.at`,
  )
    .bind(item, file, part, parts, vault, user.id, body.byteLength, now(), user.email)
    .run()
  if (!claimed.meta.changes) {
    const after = await activeIn(context.env, vault, user.email)
    if (!after) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(after, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
    const still = await context.env.DB.prepare(
      'select 1 from pass_items where vault_id = ? and id = ? and deleted_at is null',
    )
      .bind(vault, item)
      .first()
    if (!still) return context.json({ error: NO_SUCH_ITEM }, 404)
    const there = await partsOf(context.env, item, file)
    const taken = there.some((one) => one.vault_id !== vault)
    return context.json({ error: taken ? TAKEN : NOT_A_FILE }, 409)
  }

  try {
    await context.env.NOTES.put(fileObject(item, file, part), body, {
      httpMetadata: { contentType: 'application/octet-stream' },
    })
  } catch (error) {
    if (!before) {
      await context.env.DB.prepare(
        'delete from pass_file_parts where item_id = ? and file_id = ? and part = ? and vault_id = ?',
      )
        .bind(item, file, part, vault)
        .run()
    }
    throw error
  }
  return context.json({ stored: true, size: body.byteLength }, 201)
})

files.get('/files/:vault/:item/:file', async (context) => {
  const user = context.get('user')
  const { vault, item, file, ok } = idsOf(context)
  const part = countIn(context.req.query('part'), 0)
  if (!ok || part === null) return context.json({ error: NOT_A_FILE }, 400)
  if (!(await activeIn(context.env, vault, user.email))) {
    return context.json({ error: NO_SUCH_VAULT }, 404)
  }
  const row = await context.env.DB.prepare(
    'select 1 from pass_file_parts where item_id = ? and file_id = ? and part = ? and vault_id = ?',
  )
    .bind(item, file, part, vault)
    .first()
  const object = row ? await context.env.NOTES.get(fileObject(item, file, part)) : null
  if (!object) return context.json({ error: NO_SUCH_FILE }, 404)
  return new Response(object.body, {
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' },
  })
})

files.get('/files/:vault/:item', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const item = context.req.param('item')
  if (!isPassId(vault) || !isPassId(item)) return context.json({ error: NOT_A_FILE }, 400)
  if (!(await activeIn(context.env, vault, user.email))) {
    return context.json({ error: NO_SUCH_VAULT }, 404)
  }
  const { results } = await context.env.DB.prepare(
    `select file_id as id, max(parts) as parts, sum(size) as size, count(*) as held
       from pass_file_parts where vault_id = ? and item_id = ? group by file_id order by file_id`,
  )
    .bind(vault, item)
    .all<{ id: string; parts: number; size: number; held: number }>()
  return context.json({
    files: results.map((one) => ({
      id: one.id,
      parts: one.parts,
      size: one.size,
      complete: one.held === one.parts,
    })),
  })
})

files.delete('/files/:vault/:item/:file', async (context) => {
  const user = context.get('user')
  const { vault, item, file, ok } = idsOf(context)
  if (!ok) return context.json({ error: NOT_A_FILE }, 400)
  const held = await activeIn(context.env, vault, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  const known = (await partsOf(context.env, item, file)).filter((one) => one.vault_id === vault)
  if (!known.length) return context.json({ error: NO_SUCH_FILE }, 404)
  await context.env.DB.prepare(
    'delete from pass_file_parts where item_id = ? and file_id = ? and vault_id = ?',
  )
    .bind(item, file, vault)
    .run()
  await context.env.NOTES.delete(known.map((one) => fileObject(item, file, one.part)))
  return context.json({ ok: true })
})
