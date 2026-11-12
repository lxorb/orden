import { blogRootOf } from '../hosts'
import type { Env, Space } from '../types'

export function hostnameOf(host: string): string {
  return (host.toLowerCase().split(':')[0] ?? '').replace(/\.$/, '')
}

export async function spaceForHost(env: Env, host: string): Promise<Space | null> {
  const hostname = hostnameOf(host)
  if (!hostname) return null

  const root = blogRootOf(env, hostname)
  if (root && hostname !== root) {
    const subdomain = hostname.slice(0, -(root.length + 1))
    return (
      (await env.DB.prepare('select * from spaces where blog_subdomain = ? and blog_enabled = 1')
        .bind(subdomain)
        .first<Space>()) ?? null
    )
  }

  if (root) return null

  return (
    (await env.DB.prepare(
      `select * from spaces
        where blog_domain = ? and blog_enabled = 1 and blog_domain_verified_at is not null`,
    )
      .bind(hostname)
      .first<Space>()) ?? null
  )
}
