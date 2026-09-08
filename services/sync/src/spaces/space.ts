/** One space, as the rest of the service asks for it: making one, what this
 *  account may do in it, and the shape the app reads back.
 *
 *  A space is reached by its owner or by somebody the owner shared it with, and
 *  every route that takes a space id says which of the three roles it needs. An
 *  id nobody may reach is indistinguishable from one that does not exist: the
 *  answer is 404 either way, and nothing about the space leaks. An id they may
 *  reach but not at that role is 403, which is a different thing to say - the
 *  space is theirs to see, this button is not theirs to press. */

import type { Context, MiddlewareHandler } from 'hono'
import { newId, now } from '../crypto'
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

function isRole(value: unknown): value is Role {
  return value === 'owner' || isGiven(value)
}

export function allows(held: Role, needed: Role): boolean {
  return RANK[held] >= RANK[needed]
}

/** Makes a space for an account and hands it back.
 *
 *  The one place a space comes into being, so where it lands is decided once: at
 *  the end of that account's own rail, holding nothing, published nowhere. The
 *  route below `POST /v1/spaces` calls it for a space somebody asked for, and
 *  `first.ts` for the one every new account starts with. The name arrives
 *  cleaned; the icon is a name from the set the app ships, or nothing. */
export async function addSpace(
  env: Env,
  userId: string,
  name: string,
  icon: string | null = null,
): Promise<Space> {
  const last = await env.DB.prepare(
    'select max(position) as last from spaces where user_id = ? and deleted = 0',
  )
    .bind(userId)
    .first<{ last: number | null }>()

  const space: Space = {
    id: newId(),
    user_id: userId,
    name,
    position: (last?.last ?? -1) + 1,
    icon,
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
    files: '[]',
  }

  await env.DB.prepare(
    `insert into spaces (id, user_id, name, position, icon, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      space.id,
      space.user_id,
      space.name,
      space.position,
      space.icon,
      space.created_at,
      space.updated_at,
    )
    .run()

  return space
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

export async function reachedSpace(env: Env, user: User, spaceId: string): Promise<Reached | null> {
  const row = await env.DB.prepare(REACHED)
    .bind(spaceId, user.id, user.email)
    .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

/** Middleware: the space named in the path, at the role the route behind it
 *  needs, put on the request. Written once so that no route can forget it and
 *  so that the two answers - not there, not yours to do - are always the same
 *  two answers. */
export function atLeast(
  needed: Role,
  param = 'id',
): MiddlewareHandler<{
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

/** How many notes each of these spaces holds. One query for the whole listing,
 *  the way `sharedAmong` is one query rather than one per space.
 *
 *  It is what lets a machine that has just signed in say how much of the account
 *  is still on its way: the number is known before the first note has arrived,
 *  where counting the pages of a pull only ever knows what has come already. */
export async function notesAmong(
  env: Env,
  spaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (!spaceIds.length) return new Map<string, number>()

  const places = spaceIds.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `select space_id, count(*) as notes from notes
      where space_id in (${places}) and deleted = 0
      group by space_id`,
  )
    .bind(...spaceIds)
    .all<{ space_id: string; notes: number }>()

  return new Map(results.map((row) => [row.space_id, row.notes]))
}

export function presentSpace(
  space: Space,
  env: Env,
  role: Role = 'owner',
  shared = false,
  notes = 0,
) {
  return {
    id: space.id,
    name: space.name,
    position: space.position,
    icon: space.icon,
    /** How many notes it holds, so a machine bringing the account down can say
     *  how far through it is rather than only that it is working. */
    notes,
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
