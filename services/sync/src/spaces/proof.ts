import { now, randomToken } from '../crypto'
import { NO_ADDRESS } from '../refused'
import { txtAt } from '../dns'
import { claimDomain, releaseDomain } from '../hostnames'
import type { Env, Space } from '../types'
import { proofName } from './addresses'

export function newProof(): string {
  return `orden-verify=${randomToken()}`
}

const PROVED_FOR = 7 * 24 * 60 * 60 * 1000

const TRUSTED_FOR = 3 * PROVED_FOR

const NOT_YET = 'that record is not answering yet'

export async function proveDomain(
  env: Env,
  space: Space,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const domain = space.blog_domain
  const token = space.blog_domain_token
  if (!domain || !token) return { ok: false, error: NO_ADDRESS }

  const found = await txtAt(proofName(domain))
  if (!found.asked || !found.values.includes(token)) return { ok: false, error: NOT_YET }

  await env.DB.prepare('update spaces set blog_domain_verified_at = ? where id = ?')
    .bind(now(), space.id)
    .run()

  await claimDomain(env, domain)

  return { ok: true }
}

export async function recheckDomains(env: Env, at: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `select id, blog_domain, blog_domain_token, blog_domain_verified_at from spaces
      where blog_domain is not null and blog_domain_token is not null
        and blog_domain_verified_at is not null and blog_domain_verified_at < ?
      order by blog_domain_verified_at limit 100`,
  )
    .bind(at - PROVED_FOR)
    .all<{
      id: string
      blog_domain: string
      blog_domain_token: string
      blog_domain_verified_at: number
    }>()

  let lost = 0

  for (const space of results) {
    const found = await txtAt(proofName(space.blog_domain))

    if (!found.asked) continue

    if (found.values.includes(space.blog_domain_token)) {
      await env.DB.prepare('update spaces set blog_domain_verified_at = ? where id = ?')
        .bind(at, space.id)
        .run()
      continue
    }

    if (at - space.blog_domain_verified_at < TRUSTED_FOR) continue

    await env.DB.prepare('update spaces set blog_domain_verified_at = null where id = ?')
      .bind(space.id)
      .run()
    await releaseDomain(env, space.blog_domain)
    lost++
  }

  return lost
}
