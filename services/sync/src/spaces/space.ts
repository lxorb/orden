/** One space, as the rest of the service asks for it: what this account may do
 *  in it, and the shape the app reads back.
 *
 *  A space is reached by its owner or by somebody the owner shared it with, and
 *  every route that takes a space id says which of the three roles it needs. An
 *  id nobody may reach is indistinguishable from one that does not exist: the
 *  answer is 404 either way, and nothing about the space leaks. An id they may
 *  reach but not at that role is 403, which is a different thing to say - the
 *  space is theirs to see, this button is not theirs to press. */

import type { Context, MiddlewareHandler } from 'hono'
import { dnsRecords } from './addresses'
import type { Env, Space, User, Variables } from '../types'
import { readBookmarks } from './bookmarks'

/** What somebody may do in a space. Ordered: an owner may do what a writer may,
 *  and a writer what a reader may. */
export type Role = 'owner' | 'write' | 'read'

const RANK: Record<Role, number> = { read: 0, write: 1, owner: 2 }

/** A role a person can be given. The third, `owner`, is not one of these: it is
 *  the space's own column, and one owner is what owning means. */
export type Given = 'write' | 'read'

export function isGiven(value: unknown): value is Given {
  return value === 'write' || value === 'read'
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || isGiven(value)
}

export function allows(held: Role, needed: Role): boolean {
  return RANK[held] >= RANK[needed]
}

/** A space together with what the account asking may do in it. */
export interface Reached extends Space {
  role: Role
}

/** The one question everything here asks: is this space this account's to
 *  reach, and as what.
 *
 *  One query, because it runs in front of every request that names a space. The
 *  owner is the space's own column; everybody else is a row keyed by their
 *  address, which is why the address rather than the account id is bound: a
 *  membership written before the person had an account is already theirs on the
 *  day they prove it. */
const REACHED = `select sp.*,
    case when sp.user_id = ?2 then 'owner' else m.role end as role
  from spaces sp
  left join space_members m on m.space_id = sp.id and m.email = ?3
 where sp.id = ?1 and sp.deleted = 0`

export async function reachedSpace(
  env: Env,
  user: User,
  spaceId: string,
): Promise<Reached | null> {
  const row = await env.DB.prepare(REACHED)
    .bind(spaceId, user.id, user.email)
    .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

/** The space the account still owns outright, for the paths that only an owner
 *  has ever been able to take. Kept as its own name because "owned" is what
 *  those routes mean, rather than "reached at the owner role by chance". */
export async function ownedSpace(env: Env, userId: string, spaceId: string): Promise<Space | null> {
  const space = await env.DB.prepare(
    'select * from spaces where id = ? and user_id = ? and deleted = 0',
  )
    .bind(spaceId, userId)
    .first<Space>()

  return space ?? null
}

/** Middleware: the space named in the path, at the role the route behind it
 *  needs, put on the request. Written once so that no route can forget it and
 *  so that the two answers - not there, not yours to do - are always the same
 *  two answers. */
export function atLeast(needed: Role, param = 'id'): MiddlewareHandler<{
  Bindings: Env
  Variables: Variables
}> {
  return async (context, next) => {
    const asked = context.req.param(param) ?? ''
    const space = await reachedSpace(context.env, context.get('user'), asked)
    if (!space) return context.json({ error: 'no such space' }, 404)
    if (!allows(space.role, needed)) return context.json({ error: refusal(needed) }, 403)

    context.set('space', space)
    await next()
  }
}

/** Why a role was not enough, in the app's own voice. */
export function refusal(needed: Role): string {
  return needed === 'owner' ? 'only the owner can do that' : 'you can only read this space'
}

/** The space a route behind `atLeast` is working in. */
export function spaceOf(context: Context<{ Bindings: Env; Variables: Variables }>): Reached {
  return context.get('space')
}

/** Which spaces hold anybody besides their owner, so the rail can mark them.
 *  One query for the whole listing rather than one per space. */
export async function sharedAmong(env: Env, spaceIds: readonly string[]): Promise<Set<string>> {
  if (!spaceIds.length) return new Set<string>()

  const places = spaceIds.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `select distinct space_id from space_members where space_id in (${places})`,
  )
    .bind(...spaceIds)
    .all<{ space_id: string }>()

  return new Set(results.map((row) => row.space_id))
}

export function presentSpace(space: Space, env: Env, role: Role = 'owner', shared = false) {
  return {
    id: space.id,
    name: space.name,
    position: space.position,
    icon: space.icon,
    // What this account may do here, so the app knows which affordances to
    // show before it has asked for anything else.
    role,
    // Whether anybody else is in it, which is the mark the rail draws.
    shared: shared || role !== 'owner',
    // Carried on the listing rather than fetched per space: the app reads the
    // list on every reconcile pass, and one request for every space's
    // bookmarks would be one request per space.
    bookmarks: readBookmarks(space.bookmarks),
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
