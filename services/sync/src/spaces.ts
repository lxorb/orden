import { Hono } from 'hono'
import { newId, now } from './crypto'
import { cleanPath } from './notes'
import type { Env, Space, Variables } from './types'

const NAME_LIMIT = 80
// Two to thirty-two, which is what the message beside it promises. The
// optional group made one character legal and two impossible.
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/** Names people cannot take on the shared blog domain. */
const RESERVED = new Set([
  'www', 'api', 'app', 'admin', 'mail', 'smtp', 'imap', 'ns', 'ns1', 'ns2',
  'blog', 'docs', 'help', 'support', 'status', 'cdn', 'assets', 'static',
  'nib', 'markdown', 'test', 'staging', 'dev',
])

export async function ownedSpace(env: Env, userId: string, spaceId: string): Promise<Space | null> {
  const space = await env.DB.prepare(
    'select * from spaces where id = ? and user_id = ? and deleted = 0',
  )
    .bind(spaceId, userId)
    .first<Space>()

  return space ?? null
}

export const spaces = new Hono<{ Bindings: Env; Variables: Variables }>()

spaces.get('/', async (context) => {
  const user = context.get('user')
  const { results } = await context.env.DB.prepare(
    'select * from spaces where user_id = ? and deleted = 0 order by position, created_at',
  )
    .bind(user.id)
    .all<Space>()

  // The markers go too. A machine that has been away needs them to tell a
  // space that was deleted from one it has simply not uploaded yet.
  const gone = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 1',
  )
    .bind(user.id)
    .all<{ id: string }>()

  return context.json({
    spaces: results.map((one) => present(one, context.env)),
    deleted: gone.results.map((one) => one.id),
  })
})

spaces.post('/', async (context) => {
  const user = context.get('user')
  const { name } = await context.req.json<{ name?: string }>()
  const label = (name ?? '').trim().slice(0, NAME_LIMIT)

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
    created_at: now(),
    updated_at: now(),
    blog_enabled: 0,
    blog_subdomain: null,
    blog_domain: null,
    blog_note: null,
    blog_title: null,
  }

  await context.env.DB.prepare(
    'insert into spaces (id, user_id, name, position, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(space.id, space.user_id, space.name, space.position, space.created_at, space.updated_at)
    .run()

  return context.json({ space: present(space, context.env) }, 201)
})

/** The whole rail order in one go: ids in the order they should appear.
 *  Anything the account holds but the list leaves out keeps its place at the
 *  end, so a machine that has not seen a space yet cannot lose it. */
spaces.put('/order', async (context) => {
  const user = context.get('user')
  const { order } = await context.req.json<{ order?: string[] }>()
  if (!Array.isArray(order)) return context.json({ error: 'send an order' }, 400)

  const { results } = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 0',
  )
    .bind(user.id)
    .all<{ id: string }>()

  const owned = new Set(results.map((row) => row.id))
  const listed = order.filter((id) => owned.has(id))
  const rest = results.map((row) => row.id).filter((id) => !listed.includes(id))

  const ids = [...listed, ...rest]
  if (ids.length) {
    // One statement, so a half-applied order is not a state the rail can end
    // up in. The positions are array indexes, never anything sent in.
    const cases = ids.map((one, index) => `when ? then ${index}`).join(' ')
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

  const body = await context.req.json<{ name?: string; icon?: string | null }>()

  const label = body.name === undefined ? space.name : body.name.trim().slice(0, NAME_LIMIT)
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  // An icon is a name from the set the app ships, so it needs no more than a
  // sane length and no surprises in it.
  const icon =
    body.icon === undefined
      ? space.icon
      : body.icon === null
        ? null
        : /^[A-Za-z0-9]{1,64}$/.test(body.icon)
          ? body.icon
          : space.icon

  await context.env.DB.prepare(
    'update spaces set name = ?, icon = ?, updated_at = ? where id = ?',
  )
    .bind(label, icon, now(), space.id)
    .run()

  return context.json({ space: present({ ...space, name: label, icon }, context.env) })
})

spaces.delete('/:id', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  const { results } = await context.env.DB.prepare('select id from notes where space_id = ?')
    .bind(space.id)
    .all<{ id: string }>()

  await Promise.all(results.map((note) => context.env.NOTES.delete(`spaces/${space.id}/${note.id}`)))
  await context.env.DB.prepare('delete from notes where space_id = ?').bind(space.id).run()

  // The notes are gone for good; the row stays as the marker. Its published
  // address is released, or nobody could ever claim that name again.
  await context.env.DB.prepare(
    `update spaces
        set deleted = 1, blog_enabled = 0, blog_subdomain = null, blog_domain = null,
            blog_note = null, updated_at = ?
      where id = ?`,
  )
    .bind(now(), space.id)
    .run()

  return context.json({ ok: true })
})

/** Turning a space into a blog publishes every note in it. */
spaces.put('/:id/blog', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  const body = await context.req.json<{
    subdomain?: string
    domain?: string
    title?: string
    note?: string | null
  }>()
  const subdomain = body.subdomain?.trim().toLowerCase()
  const domain = body.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  if (subdomain !== undefined) {
    if (!SUBDOMAIN.test(subdomain)) {
      return context.json({ error: 'use 2–32 letters, numbers or hyphens' }, 400)
    }
    if (RESERVED.has(subdomain)) return context.json({ error: 'that name is taken' }, 409)

    const clash = await context.env.DB.prepare(
      'select id from spaces where blog_subdomain = ? and id != ?',
    )
      .bind(subdomain, space.id)
      .first()

    if (clash) return context.json({ error: 'that name is taken' }, 409)
  }

  if (domain !== undefined && domain !== '' && !DOMAIN.test(domain)) {
    return context.json({ error: 'that does not look like a domain' }, 400)
  }

  // One address, not two. A domain of their own replaces the shared name, so
  // the name goes back into the pool; choosing a name lets the domain go. A
  // request that names neither is changing something else and keeps what
  // the space had.
  const address = domain
    ? { subdomain: null, domain }
    : subdomain !== undefined
      ? { subdomain, domain: null }
      : { subdomain: space.blog_subdomain, domain: space.blog_domain }

  if (!address.subdomain && !address.domain) {
    return context.json({ error: 'choose an address' }, 400)
  }

  // A note path publishes that one note at the root; null publishes the space.
  const note = body.note === undefined ? space.blog_note : (cleanPath(body.note ?? '') ?? null)

  if (note) {
    const exists = await context.env.DB.prepare(
      'select id from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, note)
      .first()

    if (!exists) return context.json({ error: 'no such note in this space' }, 404)
  }

  await context.env.DB.prepare(
    `update spaces set blog_enabled = 1,
                       blog_subdomain = ?,
                       blog_domain = ?,
                       blog_title = coalesce(?, blog_title),
                       blog_note = ?,
                       updated_at = ?
      where id = ?`,
  )
    .bind(address.subdomain, address.domain, body.title?.trim() || null, note, now(), space.id)
    .run()

  const updated = await ownedSpace(context.env, user.id, space.id)
  return context.json({
    space: present(updated!, context.env),
    dns: dnsRecords(context.env, updated!),
  })
})

spaces.delete('/:id/blog', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  await context.env.DB.prepare(
    'update spaces set blog_enabled = 0, blog_domain = null, updated_at = ? where id = ?',
  )
    .bind(now(), space.id)
    .run()

  return context.json({ ok: true })
})

/** Whether a subdomain is free - drives the live check while typing. */
spaces.get('/available/:subdomain', async (context) => {
  const subdomain = context.req.param('subdomain').toLowerCase()

  if (!SUBDOMAIN.test(subdomain)) {
    return context.json({ available: false, reason: 'use 2–32 letters, numbers or hyphens' })
  }
  if (RESERVED.has(subdomain)) return context.json({ available: false, reason: 'that name is taken' })

  const taken = await context.env.DB.prepare('select id from spaces where blog_subdomain = ?')
    .bind(subdomain)
    .first()

  return context.json(
    taken ? { available: false, reason: 'that name is taken' } : { available: true },
  )
})

/** What the reader has to add at their registrar to point a domain here. */
export function dnsRecords(env: Env, space: Space) {
  if (!space.blog_domain) return []

  const apex = space.blog_domain.split('.').length === 2
  return [
    {
      type: apex ? 'A' : 'CNAME',
      name: space.blog_domain,
      value: apex ? '192.0.2.1' : `${space.blog_subdomain ?? space.id}.${env.BLOG_ROOT}`,
      note: apex ? 'Points the apex at Cloudflare' : 'Points the subdomain at your Nib blog',
    },
  ]
}

function present(space: Space, env: Env) {
  return {
    id: space.id,
    name: space.name,
    position: space.position,
    icon: space.icon,
    createdAt: space.created_at,
    updatedAt: space.updated_at,
    blog: {
      enabled: !!space.blog_enabled,
      subdomain: space.blog_subdomain,
      domain: space.blog_domain,
      title: space.blog_title,
      note: space.blog_note,
      // Carried on the listing as well, so the pane can show what to add at
      // the registrar after a reload and not only right after publishing.
      dns: dnsRecords(env, space),
    },
  }
}
