/** Publishing a space: the address it answers on, what it is called there,
 *  and whether one note stands for the whole thing.
 *
 *  Turning a space into a blog publishes every note in it, which is the owner's
 *  to decide and nobody else's - a writer writes in a space, they do not put it
 *  on the internet. So everything here asks for `owner` first: an id belonging
 *  to someone else is a 404, one shared with them is a 403, never a page. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { now } from '../crypto'
import { domainStatus, releaseDomain } from '../hostnames'
import { cleanPath, PATH_LIMIT } from '../notes'
import type { Env, Space, Variables } from '../types'
import {
  cleanDomain,
  dnsRecords,
  DOMAIN_LIMIT,
  looksLikeDomain,
  ours,
  reserved,
  SUBDOMAIN,
} from './addresses'
import { newProof, proveDomain } from './proof'
import { atLeast, presentSpace, spaceOf } from './space'

/** Long enough for a title, short enough that the column cannot be used as
 *  storage. A name that does not fit was never a title. */
const TITLE_LIMIT = 200
/** The pattern allows thirty-two; the field is read a little longer so that
 *  something too long is turned down by name rather than by length. */
const SUBDOMAIN_LIMIT = 64
/** Room for a scheme and a trailing slash that a person may have pasted
 *  along with the domain, all of which `cleanDomain` takes off again. */
const DOMAIN_FIELD_LIMIT = DOMAIN_LIMIT + 32

export const publish = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Turning a space into a blog publishes every note in it. */
publish.put('/:id/blog', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const subdomain = body.text('subdomain', SUBDOMAIN_LIMIT)?.trim().toLowerCase()
  const given = body.text('domain', DOMAIN_FIELD_LIMIT)
  const title = body.text('title', TITLE_LIMIT)?.trim()
  const asked = body.nullableText('note', PATH_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const domain = given === undefined ? undefined : cleanDomain(given)

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

  if (domain !== undefined && domain !== '' && !looksLikeDomain(domain)) {
    return context.json({ error: 'that does not look like a domain' }, 400)
  }

  if (domain && ours(context.env, domain)) {
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
  //
  // A domain somebody has proved is theirs, and that is the end of it. One
  // nobody has proved is nobody's: it is a sentence another account typed, and
  // it used to shut the real owner out for ever. So this claim takes it, and
  // whoever can write the record keeps it. See proof.ts.
  if (address.domain && address.domain !== space.blog_domain) {
    const clash = await context.env.DB.prepare(
      'select id, blog_domain_verified_at from spaces where blog_domain = ? and id != ?',
    )
      .bind(address.domain, space.id)
      .first<{ id: string; blog_domain_verified_at: number | null }>()

    if (clash) {
      if (clash.blog_domain_verified_at !== null) {
        return context.json({ error: 'that domain is taken' }, 409)
      }

      await context.env.DB.prepare(
        'update spaces set blog_domain = null, blog_domain_token = null, updated_at = ? where id = ?',
      )
        .bind(now(), clash.id)
        .run()
    }
  }

  // A note path publishes that one note at the root; null, an empty string, or
  // nothing at all publishes the space. A path that is not one is refused
  // rather than quietly read as "publish everything".
  let note = space.blog_note
  if (asked !== undefined) {
    note = asked ? cleanPath(asked) : null
    if (asked && note === null) return context.json({ error: 'that path is not usable' }, 400)
  }

  if (note) {
    const exists = await context.env.DB.prepare(
      'select id from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, note)
      .first()

    if (!exists) return context.json({ error: 'no such note in this space' }, 404)
  }

  // An empty title is not a title: it keeps the one the space had, which is
  // what the `coalesce` below does with a null.
  const chosenTitle = title === undefined || title === '' ? null : title

  // A domain of one's own arrives unproved, with the token the owner is to put in
  // a record; a domain that has not changed keeps the proof it had. Nothing is
  // served on it and no certificate is asked for until that record is read; see
  // proof.ts.
  const claiming = !!address.domain && address.domain !== space.blog_domain
  const proof = claiming ? newProof() : address.domain ? space.blog_domain_token : null
  const provedAt = claiming || !address.domain ? null : space.blog_domain_verified_at

  const at = now()
  await context.env.DB.prepare(
    `update spaces set blog_enabled = 1,
                       blog_subdomain = ?,
                       blog_domain = ?,
                       blog_domain_token = ?,
                       blog_domain_verified_at = ?,
                       blog_title = coalesce(?, blog_title),
                       blog_note = ?,
                       updated_at = ?
      where id = ?`,
  )
    .bind(
      address.subdomain,
      address.domain,
      proof,
      provedAt,
      chosenTitle,
      note,
      at,
      space.id,
    )
    .run()

  // The certificate for a domain given up goes at once. One for a domain just
  // chosen waits on the record: this is exactly where a certificate used to be
  // asked for in somebody else's name.
  if (space.blog_domain && space.blog_domain !== address.domain) {
    await releaseDomain(context.env, space.blog_domain)
  }

  // What was written, worked out rather than read back: the row above is the
  // only thing that changed it, and one round trip is enough.
  const updated: Space = {
    ...space,
    blog_enabled: 1,
    blog_subdomain: address.subdomain,
    blog_domain: address.domain,
    blog_domain_token: proof,
    blog_domain_verified_at: provedAt,
    blog_title: chosenTitle ?? space.blog_title,
    blog_note: note,
    updated_at: at,
  }

  return context.json({
    space: presentSpace(updated, context.env),
    dns: dnsRecords(context.env, updated),
  })
})

/** Stops serving. The shared name stays with the space, so it is there when
 *  publishing resumes; a domain of one's own is let go along with its
 *  certificate, since the owner's DNS keeps working either way and holding
 *  a certificate for a domain that serves nothing helps nobody. */
publish.delete('/:id/blog', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await context.env.DB.prepare(
    `update spaces set blog_enabled = 0,
                       blog_domain = null,
                       blog_domain_token = null,
                       blog_domain_verified_at = null,
                       updated_at = ?
      where id = ?`,
  )
    .bind(now(), space.id)
    .run()

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

  return context.json({ ok: true })
})

/** How far along a domain of one's own is, for the pane to keep asking while
 *  the owner adds the records. They ride along, so one call shows both what to
 *  do and whether it has been done.
 *
 *  A domain nobody has proved stops here. Cloudflare is not asked about it - a
 *  certificate for a name this account may not hold is the thing being prevented -
 *  and the state says which record is still wanted. */
publish.get('/:id/blog/domain', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  if (!space.blog_domain) {
    return context.json({ domain: null, state: 'none', detail: null, dns: [] })
  }

  if (space.blog_domain_verified_at === null) {
    return context.json({
      domain: space.blog_domain,
      state: 'unproved',
      detail: null,
      dns: dnsRecords(context.env, space),
    })
  }

  const status = await domainStatus(context.env, space.blog_domain)
  return context.json({
    domain: space.blog_domain,
    ...status,
    dns: dnsRecords(context.env, space),
  })
})

/** The owner saying the record is in place. Reads it now, so that adding a record
 *  and finding out whether it took is one gesture; the schedule reads it again
 *  later. Nothing else can turn a claim into an address. */
publish.post('/:id/blog/domain/verify', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  if (!space.blog_domain) {
    return context.json({ domain: null, state: 'none', detail: null, dns: [] })
  }

  const proved = await proveDomain(context.env, space)
  if (!proved.ok) {
    return context.json(
      {
        domain: space.blog_domain,
        state: 'unproved',
        detail: proved.error,
        dns: dnsRecords(context.env, space),
      },
      409,
    )
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
publish.get('/available/:subdomain', async (context) => {
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
