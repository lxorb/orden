/** Spaces: the rail the app shows, in the order the person put them in.
 *
 *  A space is the unit of everything else - notes belong to one, publishing is
 *  a property of one - so this file is only the space itself: making one,
 *  naming it, ordering the rail, taking one away. What a published space
 *  answers on is in publish.ts, under the same paths. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { newId, now } from '../crypto'
import { releaseDomain } from '../hostnames'
import type { Env, Space, Variables } from '../types'
import { bookmarks } from './bookmarks'
import { publish } from './publish'
import { ownedSpace, presentSpace } from './space'

const NAME_LIMIT = 80
/** An id is a UUID; the length is all this needs to know. */
const ID_LIMIT = 64
/** More spaces than anyone has, and a bound on the one statement below that
 *  grows with what was sent. */
const MOST_IN_ORDER = 500

export const spaces = new Hono<{ Bindings: Env; Variables: Variables }>()

spaces.get('/', async (context) => {
  const user = context.get('user')
  const { results } = await context.env.DB.prepare(
    'select * from spaces where user_id = ? and deleted = 0 order by position, created_at limit ?',
  )
    .bind(user.id, MOST_IN_ORDER)
    .all<Space>()

  // The markers go too. A machine that has been away needs them to tell a
  // space that was deleted from one it has simply not uploaded yet.
  const gone = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 1 limit ?',
  )
    .bind(user.id, MOST_IN_ORDER)
    .all<{ id: string }>()

  return context.json({
    spaces: results.map((one) => presentSpace(one, context.env)),
    deleted: gone.results.map((one) => one.id),
  })
})

spaces.post('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const name = body.text('name', NAME_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const label = (name ?? '').trim()
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  const last = await context.env.DB.prepare(
    'select max(position) as last from spaces where user_id = ? and deleted = 0',
  )
    .bind(user.id)
    .first<{ last: number | null }>()

  const space: Space = {
    id: newId(),
    user_id: user.id,
    name: label,
    position: (last?.last ?? -1) + 1,
    icon: null,
    deleted: 0,
    deleted_at: null,
    created_at: now(),
    updated_at: now(),
    blog_enabled: 0,
    blog_subdomain: null,
    blog_domain: null,
    blog_note: null,
    blog_title: null,
    bookmarks: '[]',
  }

  await context.env.DB.prepare(
    'insert into spaces (id, user_id, name, position, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(space.id, space.user_id, space.name, space.position, space.created_at, space.updated_at)
    .run()

  return context.json({ space: presentSpace(space, context.env) }, 201)
})

/** The whole rail order in one go: ids in the order they should appear.
 *  Anything the account holds but the list leaves out keeps its place at the
 *  end, so a machine that has not seen a space yet cannot lose it. */
spaces.put('/order', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const order = body.texts('order', MOST_IN_ORDER, ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!order) return context.json({ error: 'send an order' }, 400)

  const { results } = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 0 limit ?',
  )
    .bind(user.id, MOST_IN_ORDER)
    .all<{ id: string }>()

  const owned = new Set(results.map((row) => row.id))
  const listed = order.filter((id) => owned.has(id))
  const rest = results.map((row) => row.id).filter((id) => !listed.includes(id))

  const ids = [...listed, ...rest]
  if (ids.length) {
    // One statement, so a half-applied order is not a state the rail can end
    // up in. The positions are array indexes, never anything sent in.
    const cases = ids.map((_, index) => `when ? then ${index}`).join(' ')
    await context.env.DB.prepare(
      `update spaces set position = case id ${cases} else position end where user_id = ?`,
    )
      .bind(...ids, user.id)
      .run()
  }

  return context.json({ ok: true })
})

spaces.patch('/:id', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  const body = await readBody(context)
  const name = body.text('name', NAME_LIMIT)
  const chosen = body.nullableText('icon', ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const label = name === undefined ? space.name : name.trim()
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  // An icon is a name from the set the app ships. One that is not a name from
  // any set leaves the icon as it was rather than being written: a newer app
  // may know icons this version does not, but nothing that is not an icon name
  // has any business in the column.
  const icon =
    chosen === undefined
      ? space.icon
      : chosen === null
        ? null
        : /^[A-Za-z0-9]{1,64}$/.test(chosen)
          ? chosen
          : space.icon

  await context.env.DB.prepare('update spaces set name = ?, icon = ?, updated_at = ? where id = ?')
    .bind(label, icon, now(), space.id)
    .run()

  return context.json({ space: presentSpace({ ...space, name: label, icon }, context.env) })
})

spaces.delete('/:id', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  // The notes stay with it, so the space can be put back whole from Recently
  // deleted; the purge in trash.ts empties it after 14 days. Its published
  // address is released now, or nobody could claim that name meanwhile.
  const at = now()
  await context.env.DB.prepare(
    `update spaces
        set deleted = 1, deleted_at = ?, blog_enabled = 0, blog_subdomain = null, blog_domain = null,
            blog_note = null, updated_at = ?
      where id = ?`,
  )
    .bind(at, at, space.id)
    .run()

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

  return context.json({ ok: true })
})

// A space's published side and its bookmarks answer under these same paths.
// Mounted last, so `/order` above is still read as a word and not as an id.
spaces.route('/', publish)
spaces.route('/', bookmarks)
