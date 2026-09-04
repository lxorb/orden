import { Hono } from 'hono'
import { newId, now } from './crypto'
import { claimDomain, domainStatus, releaseDomain } from './hostnames'
import { cleanPath } from './notes'
import type { Env, Space, Variables } from './types'

const NAME_LIMIT = 80
// Two to thirty-two, which is what the message beside it promises. The
// optional group made one character legal and two impossible.
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/** Names people cannot take on the shared blog domain.
 *
 *  Only what is in use, or must not be usable, is held back; a name that is
 *  merely plausible is free until the day it is needed. The list was derived
 *  on 2026-09-04 from the zone itself: its records are the apex, the wildcard
 *  that serves every blog, and Email Routing's MX, SPF and DKIM; its Worker
 *  routes are the apex and the wildcard; it has no Worker custom domains. So
 *  nothing named is in use, and what is kept is structural: `www` because
 *  it is the site by convention, the mail names because mail records exist,
 *  and the nameserver names because a blog there would be read as the zone's
 *  own. The CNAME target for domains of one's own is held back too, from its
 *  setting rather than from here, since it is the one name that must never
 *  publish anything.
 *
 *  Extend this when a record, route or custom domain is added on a new label
 *  of the zone, and only then. */
const RESERVED = new Set(['www', 'mail', 'smtp', 'imap', 'ns', 'ns1', 'ns2'])

function reserved(env: Env, subdomain: string): boolean {
  return RESERVED.has(subdomain) || subdomain === env.BLOG_CNAME_TARGET.split('.')[0]
}

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

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

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
    if (reserved(context.env, subdomain)) return context.json({ error: 'that name is taken' }, 409)

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

  // The shared domain and everything under it are the app's and the pool's.
  // A row naming the apex would put a blog in front of the app for everyone;
  // one naming a subdomain would be a name taken without going through the
  // pool, and a certificate asked for inside the zone's own.
  const own = [context.env.BLOG_ROOT, new URL(context.env.APP_ORIGIN).hostname]
  if (domain && own.some((root) => domain === root || domain.endsWith(`.${root}`))) {
    return context.json({ error: 'use a domain of your own' }, 400)
  }

  // One address, not two. A domain of their own replaces the shared name, so
  // the name goes back into the pool; choosing a name lets the domain go. A
  // request that names neither is changing something else and keeps what
  // the space had. The database holds the same line, so nothing below can
  // write both even by mistake.
  const address = domain
    ? { subdomain: null, domain }
    : subdomain !== undefined
      ? { subdomain, domain: null }
      : { subdomain: space.blog_subdomain, domain: space.blog_domain }

  if (!address.subdomain && !address.domain) {
    return context.json({ error: 'choose an address' }, 400)
  }

  // Checked like a name is, so the answer is a clear no and not the unique
  // index failing halfway through.
  if (address.domain && address.domain !== space.blog_domain) {
    const clash = await context.env.DB.prepare(
      'select id from spaces where blog_domain = ? and id != ?',
    )
      .bind(address.domain, space.id)
      .first()

    if (clash) return context.json({ error: 'that domain is taken' }, 409)
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

  // Cloudflare follows the row: the certificate for a domain given up goes,
  // one for a domain just chosen is asked for. Neither can fail the request.
  if (space.blog_domain && space.blog_domain !== address.domain) {
    await releaseDomain(context.env, space.blog_domain)
  }
  if (address.domain && address.domain !== space.blog_domain) {
    await claimDomain(context.env, address.domain)
  }

  const updated = await ownedSpace(context.env, user.id, space.id)
  return context.json({
    space: present(updated!, context.env),
    dns: dnsRecords(context.env, updated!),
  })
})

/** Stops serving. The shared name stays with the space, so it is there when
 *  publishing resumes; a domain of one's own is let go along with its
 *  certificate, since the owner's DNS keeps working either way and holding
 *  a certificate for a domain that serves nothing helps nobody. */
spaces.delete('/:id/blog', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  await context.env.DB.prepare(
    'update spaces set blog_enabled = 0, blog_domain = null, updated_at = ? where id = ?',
  )
    .bind(now(), space.id)
    .run()

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

  return context.json({ ok: true })
})

/** How far along a domain of one's own is, for the pane to keep asking while
 *  the owner adds the record. The records ride along, so one call shows
 *  both what to do and whether it has been done. */
spaces.get('/:id/blog/domain', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  if (!space.blog_domain) {
    return context.json({ domain: null, state: 'none', detail: null, dns: [] })
  }

  const status = await domainStatus(context.env, space.blog_domain)
  return context.json({
    domain: space.blog_domain,
    ...status,
    dns: dnsRecords(context.env, space),
  })
})

/** Whether a subdomain is free - drives the live check while typing.
 *
 *  `?space=` names the space being published: a name it already holds is
 *  free for it, and would otherwise read as taken by itself. Only the
 *  caller's own space counts, or anyone could clear a name by naming the
 *  space that holds it. */
spaces.get('/available/:subdomain', async (context) => {
  const user = context.get('user')
  const subdomain = context.req.param('subdomain').toLowerCase()
  const except = context.req.query('space') ?? ''

  if (!SUBDOMAIN.test(subdomain)) {
    return context.json({ available: false, reason: 'use 2–32 letters, numbers or hyphens' })
  }
  if (reserved(context.env, subdomain)) {
    return context.json({ available: false, reason: 'that name is taken' })
  }

  const taken = await context.env.DB.prepare(
    'select id from spaces where blog_subdomain = ? and not (id = ? and user_id = ?)',
  )
    .bind(subdomain, except, user.id)
    .first()

  return context.json(
    taken ? { available: false, reason: 'that name is taken' } : { available: true },
  )
})

/** What the owner has to add at their registrar to point a domain here: one
 *  CNAME to the shared target, whatever the domain. The target is fixed
 *  rather than the space's own name, because a space on a domain of its own
 *  has no name on the shared domain, and because Cloudflare validates the
 *  certificate by that CNAME.
 *
 *  Two labels is the root of a domain, where DNS forbids a CNAME. Most
 *  providers offer an ALIAS or ANAME record, or flatten the CNAME themselves;
 *  the note says so. A longer name can be a root too (example.co.uk), which
 *  the owner will know and the note does not need to. */
export function dnsRecords(env: Env, space: Space): { type: string; name: string; value: string; note?: string }[] {
  if (!space.blog_domain) return []

  const apex = space.blog_domain.split('.').length === 2
  return [
    {
      type: 'CNAME',
      name: space.blog_domain,
      value: env.BLOG_CNAME_TARGET,
      ...(apex
        ? {
            note: 'At the root of a domain, use an ALIAS or ANAME record, or CNAME flattening, if your provider does not allow a CNAME there.',
          }
        : {}),
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
