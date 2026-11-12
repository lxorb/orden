import { Hono } from 'hono'
import { NOT_A_PATH, NO_ADDRESS } from '../refused'
import { readBody } from '../body'
import { now } from '../crypto'
import { domainStatus, releaseDomain } from '../hostnames'
import { PATH_LIMIT, readablePath } from '../notes'
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
import { fillFronts } from '../site/fill'
import { newProof, proveDomain } from './proof'
import { atLeast, presentSpace, spaceOf } from './space'

const TITLE_LIMIT = 200
const SUBDOMAIN_LIMIT = 64
const DOMAIN_FIELD_LIMIT = DOMAIN_LIMIT + 32

function proofFor(
  space: Space,
  domain: string | null,
): { token: string | null; provedAt: number | null } {
  if (!domain) return { token: null, provedAt: null }

  if (domain === space.blog_domain) {
    return { token: space.blog_domain_token, provedAt: space.blog_domain_verified_at }
  }

  return { token: newProof(), provedAt: null }
}

export const publish = new Hono<{ Bindings: Env; Variables: Variables }>()

publish.put('/:id/blog', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await fillFronts(context.env, space.id).catch(() => 0)

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

  const address = domain
    ? { subdomain: null, domain }
    : subdomain !== undefined
      ? { subdomain, domain: null }
      : { subdomain: space.blog_subdomain, domain: space.blog_domain }

  if (!address.subdomain && !address.domain) {
    return context.json({ error: NO_ADDRESS }, 400)
  }

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

  let note = space.blog_note
  if (asked !== undefined) {
    note = asked ? readablePath(asked) : null
    if (asked && note === null) return context.json({ error: NOT_A_PATH }, 400)
  }

  if (note) {
    const exists = await context.env.DB.prepare(
      'select id from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, note)
      .first()

    if (!exists) return context.json({ error: 'no such note in this space' }, 404)
  }

  const chosenTitle = title === undefined || title === '' ? null : title

  const proof = proofFor(space, address.domain)

  const at = now()
  const wrote = await context.env.DB.prepare(
    `update spaces set blog_enabled = 1,
                       blog_subdomain = ?,
                       blog_domain = ?,
                       blog_domain_token = ?,
                       blog_domain_verified_at = ?,
                       blog_title = coalesce(?, blog_title),
                       blog_note = ?,
                       updated_at = ?
      where id = ?8
        and not exists (select 1 from spaces where id != ?8 and (blog_subdomain = ?1 or blog_domain = ?2))`,
  )
    .bind(
      address.subdomain,
      address.domain,
      proof.token,
      proof.provedAt,
      chosenTitle,
      note,
      at,
      space.id,
    )
    .run()

  if (!wrote.meta.changes) {
    return context.json(
      { error: address.domain ? 'that domain is taken' : 'that name is taken' },
      409,
    )
  }

  if (space.blog_domain && space.blog_domain !== address.domain) {
    await releaseDomain(context.env, space.blog_domain)
  }

  const updated: Space = {
    ...space,
    blog_enabled: 1,
    blog_subdomain: address.subdomain,
    blog_domain: address.domain,
    blog_domain_token: proof.token,
    blog_domain_verified_at: proof.provedAt,
    blog_title: chosenTitle ?? space.blog_title,
    blog_note: note,
    updated_at: at,
  }

  return context.json({
    space: presentSpace(updated, context.env),
    dns: dnsRecords(context.env, updated),
  })
})

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
