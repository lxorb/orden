/** One space, as the rest of the service asks for it: the signed-in account's
 *  copy or nothing at all, and the shape the app reads back.
 *
 *  Every route that takes a space id goes through `ownedSpace`, so an id from
 *  another account is indistinguishable from one that does not exist: the
 *  answer is 404 either way, and nothing about the space leaks. */

import { dnsRecords } from './addresses'
import type { Env, Space } from '../types'

export async function ownedSpace(env: Env, userId: string, spaceId: string): Promise<Space | null> {
  const space = await env.DB.prepare(
    'select * from spaces where id = ? and user_id = ? and deleted = 0',
  )
    .bind(spaceId, userId)
    .first<Space>()

  return space ?? null
}

export function presentSpace(space: Space, env: Env) {
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
