import { isPassId, MOST_ITEMS, MOST_VERSIONS } from '@orden/pass/wire'
import { Hono } from 'hono'
import {
  readBody,
  now,
  mayWritePassItems,
  OUT_OF_SPACE,
  TOO_MANY_CHANGES,
  fits,
  type Env,
  type Variables,
} from '../../sync-server/src/api'
import { activeIn, holdsSql, mayAct } from './access'
import { filesGone, ITEM_FILES_GONE } from './files'
import { type Sealed, sealedIn } from './item-body'
import {
  NO_SUCH_ITEM,
  NO_SUCH_VAULT,
  NOT_AN_ITEM,
  NOT_YOUR_ROLE,
  ROTATED,
  STALE,
  TOO_MANY_ITEMS,
} from './refusals'
import { ITEM_COLUMNS, type ItemDb, itemRowOf, versionOf, type VersionDb } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, tellVault } from './tell'

export const items = new Hono<{ Bindings: Env; Variables: Variables }>()

const CURRENT_KEY = '(select key_version from pass_vaults where id = ?1 and deleted_at is null)'
const LIVE = '(select count(*) from pass_items where vault_id = ?1 and deleted_at is null)'

export async function itemOf(env: Env, vault: string, id: string): Promise<ItemDb | null> {
  return await env.DB.prepare(
    `select ${ITEM_COLUMNS} from pass_items where vault_id = ? and id = ?`,
  )
    .bind(vault, id)
    .first<ItemDb>()
}

function writeOf(
  db: D1Database,
  vault: string,
  id: string,
  sent: Sealed,
  at: number,
  email: string,
) {
  if (sent.rev === 0) {
    return db
      .prepare(
        `insert into pass_items (vault_id, id, rev, key, body, key_version, at, deleted_at, seq)
         select ?1, ?2, 1, ?3, ?4, ?5, ?6, null, ${SEQ}
          where ${CURRENT_KEY} = ?5 and ${LIVE} < ?7 and ${holdsSql('?1', '?8', 'editor')}
         on conflict(vault_id, id) do nothing`,
      )
      .bind(vault, id, sent.key, sent.body, sent.keyVersion, at, MOST_ITEMS, email)
  }
  return db
    .prepare(
      `update pass_items set rev = rev + 1, key = ?4, body = ?5, key_version = ?6, at = ?7,
              deleted_at = null, seq = ${SEQ}
        where vault_id = ?1 and id = ?2 and rev = ?3 and ${CURRENT_KEY} = ?6
          and (deleted_at is null or ${LIVE} < ?8) and ${holdsSql('?1', '?9', 'editor')}`,
    )
    .bind(vault, id, sent.rev, sent.key, sent.body, sent.keyVersion, at, MOST_ITEMS, email)
}

function keepOld(db: D1Database, vault: string, id: string, sent: Sealed) {
  return db
    .prepare(
      `insert into pass_versions (vault_id, id, rev, key, body, key_version, at)
       select vault_id, id, rev, key, body, key_version, at from pass_items
        where vault_id = ?1 and id = ?2 and rev = ?3 and deleted_at is null
          and ${CURRENT_KEY} = ?4
       on conflict(vault_id, id, rev) do nothing`,
    )
    .bind(vault, id, sent.rev, sent.keyVersion)
}

function holdLinks(db: D1Database, vault: string, id: string, sent: Sealed, trashed: boolean) {
  return db
    .prepare(
      `update pass_links set held_at = case when ?5 then coalesce(held_at, ?6) else null end
        where vault_id = ?1 and item_id = ?2
          and exists (select 1 from pass_items where vault_id = ?1 and id = ?2 and rev = ?3
                                                 and body = ?4 and deleted_at is null)`,
    )
    .bind(vault, id, sent.rev + 1, sent.body, trashed ? 1 : 0, now())
}

function trimOld(db: D1Database, vault: string, id: string) {
  return db
    .prepare(
      `delete from pass_versions where vault_id = ?1 and id = ?2
          and rev not in (select rev from pass_versions where vault_id = ?1 and id = ?2
                           order by rev desc limit ?3)`,
    )
    .bind(vault, id, MOST_VERSIONS)
}

items.put('/items/:vault/:id', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const sent = sealedIn(body)
  const trashed = body.flag('trashed')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!sent || !isPassId(vault) || !isPassId(id)) return context.json({ error: NOT_AN_ITEM }, 400)

  const held = await activeIn(context.env, vault, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  if (sent.keyVersion !== held.key_version) {
    return context.json({ error: ROTATED, keyVersion: held.key_version }, 409)
  }
  if (!(await mayWritePassItems(context.env, user.id))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }
  if (!(await fits(context.env, held.owner_id, sent.body.length + sent.key.length))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const db = context.env.DB
  const at = now()
  const write = writeOf(db, vault, id, sent, at, user.email)
  const holding = trashed === undefined ? [] : [holdLinks(db, vault, id, sent, trashed)]
  const results = await db.batch(
    sent.rev === 0
      ? [bump(db), write, ...holding]
      : [bump(db), keepOld(db, vault, id, sent), write, trimOld(db, vault, id), ...holding],
  )
  if (!results[sent.rev === 0 ? 1 : 2]?.meta.changes) {
    const current = await itemOf(context.env, vault, id)
    const after = await activeIn(context.env, vault, user.email)
    if (!after) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(after, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
    if (after.key_version !== sent.keyVersion) {
      return context.json({ error: ROTATED, keyVersion: after.key_version }, 409)
    }
    if ((current?.rev ?? 0) === sent.rev) return context.json({ error: TOO_MANY_ITEMS }, 409)
    return context.json({ error: STALE, current: current && itemRowOf(current) }, 409)
  }
  await tellVault(context.env, vault, [user.id], from)
  return context.json({ rev: sent.rev + 1, at })
})

items.delete('/items/:vault/:id', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const rev = Number(context.req.query('rev') ?? '')
  if (!Number.isSafeInteger(rev) || rev < 1 || !isPassId(id)) {
    return context.json({ error: NOT_AN_ITEM }, 400)
  }
  const held = await activeIn(context.env, vault, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)

  const db = context.env.DB
  const gone =
    'exists (select 1 from pass_items where vault_id = ?1 and id = ?2 and deleted_at is not null)'
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_items set rev = rev + 1, key = '', body = '', deleted_at = ?4, seq = ${SEQ}
          where vault_id = ?1 and id = ?2 and rev = ?3 and deleted_at is null
            and ${holdsSql('?1', '?5', 'editor')}`,
      )
      .bind(vault, id, rev, now(), user.email),
    db
      .prepare(`delete from pass_versions where vault_id = ?1 and id = ?2 and ${gone}`)
      .bind(vault, id),
    db
      .prepare(`delete from pass_links where vault_id = ?1 and item_id = ?2 and ${gone}`)
      .bind(vault, id),
    ...filesGone(db, ITEM_FILES_GONE, [vault, id]),
  ])
  if (!results[1]?.meta.changes) {
    const after = await activeIn(context.env, vault, user.email)
    if (!after) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(after, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
    const current = await itemOf(context.env, vault, id)
    if (!current) return context.json({ error: NO_SUCH_ITEM }, 404)
    return context.json({ error: STALE, current: itemRowOf(current) }, 409)
  }
  await tellVault(context.env, vault, [user.id], from)
  return context.json({ rev: rev + 1 })
})

items.get('/items/:vault/:id/versions', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const id = context.req.param('id')
  if (!(await activeIn(context.env, vault, user.email))) {
    return context.json({ error: NO_SUCH_VAULT }, 404)
  }
  const current = await itemOf(context.env, vault, id)
  if (current?.deleted_at !== null) return context.json({ error: NO_SUCH_ITEM }, 404)
  const { results } = await context.env.DB.prepare(
    `select rev, key, body, key_version, at from pass_versions
      where vault_id = ? and id = ? order by rev desc limit ?`,
  )
    .bind(vault, id, MOST_VERSIONS)
    .all<VersionDb>()
  return context.json({ versions: results.map(versionOf) })
})
