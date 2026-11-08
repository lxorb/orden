import { isPassId, MOST_ITEMS } from '@orden/pass/wire'
import { Hono } from 'hono'
import { readBody } from '../body'
import { now } from '../crypto'
import type { Env, Variables } from '../types'
import { activeIn, holdsSql, mayAct } from './access'
import { sealedIn } from './item-body'
import { itemOf } from './items'
import {
  NO_SUCH_VAULT,
  NOT_AN_ITEM,
  NOT_YOUR_ROLE,
  ROTATED,
  STALE,
  TAKEN,
  TOO_MANY_ITEMS,
} from './refusals'
import { itemRowOf } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, membersOf, tell } from './tell'

export const moves = new Hono<{ Bindings: Env; Variables: Variables }>()

moves.post('/items/:vault/:id/move', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const to = body.text('to', 64)
  const sent = sealedIn(body)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!sent || sent.rev < 1 || !isPassId(id) || !isPassId(to) || to === vault) {
    return context.json({ error: NOT_AN_ITEM }, 400)
  }

  const [source, target] = await Promise.all([
    activeIn(context.env, vault, user.email),
    activeIn(context.env, to, user.email),
  ])
  if (!source || !target) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(source, 'editor') || !mayAct(target, 'editor')) {
    return context.json({ error: NOT_YOUR_ROLE }, 403)
  }
  if (sent.keyVersion !== target.key_version) {
    return context.json({ error: ROTATED, keyVersion: target.key_version }, 409)
  }

  const db = context.env.DB
  const at = now()
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `insert into pass_items (vault_id, id, rev, key, body, key_version, at, deleted_at, seq)
         select ?1, ?2, 1, ?3, ?4, ?5, ?6, null, ${SEQ}
          where exists (select 1 from pass_items where vault_id = ?7 and id = ?2 and rev = ?8
                          and deleted_at is null)
            and (select key_version from pass_vaults where id = ?1 and deleted_at is null) = ?5
            and (select count(*) from pass_items where vault_id = ?1 and deleted_at is null) < ?9
            and ${holdsSql('?1', '?10', 'editor')} and ${holdsSql('?7', '?10', 'editor')}
         on conflict(vault_id, id) do update set
           rev = pass_items.rev + 1, key = excluded.key, body = excluded.body,
           key_version = excluded.key_version, at = excluded.at, deleted_at = null,
           seq = excluded.seq
          where pass_items.deleted_at is not null`,
      )
      .bind(
        to,
        id,
        sent.key,
        sent.body,
        sent.keyVersion,
        at,
        vault,
        sent.rev,
        MOST_ITEMS,
        user.email,
      ),
    bump(db),
    db
      .prepare(
        `update pass_items set rev = rev + 1, key = '', body = '', deleted_at = ?4, seq = ${SEQ}
          where vault_id = ?1 and id = ?2 and rev = ?3 and deleted_at is null
            and exists (select 1 from pass_items where vault_id = ?5 and id = ?2
                          and deleted_at is null and seq = ${SEQ} - 1)`,
      )
      .bind(vault, id, sent.rev, at, to),
    db
      .prepare(
        `delete from pass_versions where vault_id = ?1 and id = ?2
            and exists (select 1 from pass_items where vault_id = ?1 and id = ?2
                          and deleted_at is not null)`,
      )
      .bind(vault, id),
    db
      .prepare(
        `delete from pass_links where vault_id = ?1 and item_id = ?2
            and exists (select 1 from pass_items where vault_id = ?1 and id = ?2
                          and deleted_at is not null)`,
      )
      .bind(vault, id),
    db
      .prepare(
        `update pass_file_parts set vault_id = ?1 where vault_id = ?2 and item_id = ?3
            and exists (select 1 from pass_items where vault_id = ?2 and id = ?3
                          and deleted_at is not null)
            and exists (select 1 from pass_items where vault_id = ?1 and id = ?3
                          and deleted_at is null)`,
      )
      .bind(to, vault, id),
  ])

  if (!results[3]?.meta.changes) {
    const [one, other] = await Promise.all([
      activeIn(context.env, vault, user.email),
      activeIn(context.env, to, user.email),
    ])
    if (!one || !other) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(one, 'editor') || !mayAct(other, 'editor')) {
      return context.json({ error: NOT_YOUR_ROLE }, 403)
    }
    const current = await itemOf(context.env, vault, id)
    if (current?.deleted_at !== null || current.rev !== sent.rev) {
      return context.json({ error: STALE, current: current && itemRowOf(current) }, 409)
    }
    const there = await itemOf(context.env, to, id)
    if (there?.deleted_at === null) return context.json({ error: TAKEN }, 409)
    if (other.key_version !== sent.keyVersion) {
      return context.json({ error: ROTATED, keyVersion: other.key_version }, 409)
    }
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }

  const [one, other] = await Promise.all([
    membersOf(context.env, vault),
    membersOf(context.env, to),
  ])
  await tell(context.env, [user.id, ...one, ...other], from)
  const moved = await itemOf(context.env, to, id)
  return context.json({ rev: moved?.rev ?? 1, at })
})
