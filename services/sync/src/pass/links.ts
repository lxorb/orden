import {
  isCount,
  isPassId,
  isSealed,
  LONGEST_LINK,
  MOST_ITEM_BYTES,
  MOST_LINK_VIEWS,
  MOST_LINKS,
} from '@orden/pass/wire'
import { Hono } from 'hono'
import { objectBody } from '../body'
import { now } from '../crypto'
import { NOT_AN_OBJECT } from '../refused'
import type { Env, Variables } from '../types'
import { activeIn, holdsSql, mayAct } from './access'
import { itemOf } from './items'
import {
  NO_SUCH_ITEM,
  NO_SUCH_LINK,
  NO_SUCH_VAULT,
  NOT_A_LINK,
  NOT_YOUR_ROLE,
  TAKEN,
  TOO_MANY_LINKS,
} from './refusals'
import { LINK_COLUMNS, type LinkDb, linkRowOf } from './rows'

export const links = new Hono<{ Bindings: Env; Variables: Variables }>()

const USED_UP = 'max_views is not null and views >= max_views'

function viewsIn(value: unknown): number | null | undefined {
  if (value === null) return null
  return isCount(value) && value >= 1 && value <= MOST_LINK_VIEWS ? value : undefined
}

links.post('/links', async (context) => {
  const user = context.get('user')
  const sent = await objectBody(context)
  if (!sent) return context.json({ error: NOT_AN_OBJECT }, 400)
  const { id, vault, item, body, expires } = sent
  const views = viewsIn(sent.views)
  const at = now()
  if (
    !isPassId(id) ||
    !isPassId(vault) ||
    !isPassId(item) ||
    !isSealed(body, MOST_ITEM_BYTES) ||
    !isCount(expires) ||
    expires <= at ||
    expires > at + LONGEST_LINK ||
    views === undefined
  )
    return context.json({ error: NOT_A_LINK }, 400)

  const held = await activeIn(context.env, vault, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'editor')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  const target = await itemOf(context.env, vault, item)
  if (target?.deleted_at !== null) return context.json({ error: NO_SUCH_ITEM }, 404)

  const written = await context.env.DB.prepare(
    `insert into pass_links
       (id, user_id, vault_id, item_id, body, expires_at, max_views, views, created_at)
     select ?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8
      where (select count(*) from pass_links where user_id = ?2) < ?9
        and exists (select 1 from pass_items
                     where vault_id = ?3 and id = ?4 and deleted_at is null)
        and ${holdsSql('?3', '?10', 'editor')}
     on conflict(id) do nothing`,
  )
    .bind(id, user.id, vault, item, body, expires, views, at, MOST_LINKS, user.email)
    .run()
  if (!written.meta.changes) {
    const taken = await context.env.DB.prepare('select 1 as one from pass_links where id = ?')
      .bind(id)
      .first()
    if (taken) return context.json({ error: TAKEN }, 409)
    if (!(await activeIn(context.env, vault, user.email))) {
      return context.json({ error: NO_SUCH_VAULT }, 404)
    }
    const still = await itemOf(context.env, vault, item)
    if (still?.deleted_at !== null) return context.json({ error: NO_SUCH_ITEM }, 404)
    return context.json({ error: TOO_MANY_LINKS }, 409)
  }
  return context.json({
    link: linkRowOf({
      id,
      vault_id: vault,
      item_id: item,
      expires_at: expires,
      max_views: views,
      views: 0,
      created_at: at,
    }),
  })
})

links.get('/links', async (context) => {
  const user = context.get('user')
  const { results } = await context.env.DB.prepare(
    `select ${LINK_COLUMNS} from pass_links where user_id = ? order by created_at desc`,
  )
    .bind(user.id)
    .all<LinkDb>()
  return context.json({ links: results.map(linkRowOf) })
})

links.delete('/links/:id', async (context) => {
  const user = context.get('user')
  const gone = await context.env.DB.prepare('delete from pass_links where id = ? and user_id = ?')
    .bind(context.req.param('id'), user.id)
    .run()
  if (!gone.meta.changes) return context.json({ error: NO_SUCH_LINK }, 404)
  return context.json({ ok: true })
})

links.delete('/links', async (context) => {
  const user = context.get('user')
  if (context.req.query('expired') !== '1') return context.json({ error: NOT_A_LINK }, 400)
  const gone = await context.env.DB.prepare(
    `delete from pass_links where user_id = ? and (expires_at <= ? or (${USED_UP}))`,
  )
    .bind(user.id, now())
    .run()
  return context.json({ deleted: gone.meta.changes })
})

export async function sweepPassLinks(env: Env, at: number): Promise<void> {
  await env.DB.prepare(
    `update pass_links set body = '' where body <> '' and (expires_at <= ? or (${USED_UP}))`,
  )
    .bind(at)
    .run()
}
