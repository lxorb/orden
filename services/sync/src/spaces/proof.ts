import { now, randomToken } from '../crypto'
import { NO_ADDRESS } from '../refused'
import { txtAt } from '../dns'
import { claimDomain, releaseDomain } from '../hostnames'
import type { Env, Space } from '../types'
import { proofNames } from './addresses'

export function newProof(): string {
  return `orden-verify=${randomToken()}`
}

const PROVED_FOR = 7 * 24 * 60 * 60 * 1000

const TRUSTED_FOR = 3 * PROVED_FOR

const NOT_YET = 'that record is not answering yet'

async function proofAt(domain: string): Promise<{ asked: boolean; values: string[] }> {
  const found = await Promise.all(proofNames(domain).map((name) => txtAt(name)))
  return {
    asked: found.every((one) => one.asked),
    values: found.flatMap((one) => (one.asked ? one.values : [])),
  }
}

async function stamped(
  env: Env,
  id: string,
  domain: string,
  token: string,
  at: number | null,
): Promise<boolean> {
  const wrote = await env.DB.prepare(
    `update spaces set blog_domain_verified_at = ?
      where id = ? and blog_domain = ? and blog_domain_token = ?`,
  )
    .bind(at, id, domain, token)
    .run()
  return wrote.meta.changes > 0
}

export async function proveDomain(
  env: Env,
  space: Space,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const domain = space.blog_domain
  const token = space.blog_domain_token
  if (!domain || !token) return { ok: false, error: NO_ADDRESS }

  const found = await proofAt(domain)
  if (!found.values.includes(token)) return { ok: false, error: NOT_YET }

  if (!(await stamped(env, space.id, domain, token, now()))) return { ok: false, error: NOT_YET }

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
    const found = await proofAt(space.blog_domain)

    if (found.values.includes(space.blog_domain_token)) {
      await stamped(env, space.id, space.blog_domain, space.blog_domain_token, at)
      continue
    }

    if (!found.asked) continue

    if (at - space.blog_domain_verified_at < TRUSTED_FOR) continue

    if (!(await stamped(env, space.id, space.blog_domain, space.blog_domain_token, null))) continue
    await releaseDomain(env, space.blog_domain)
    lost++
  }

  return lost
}
