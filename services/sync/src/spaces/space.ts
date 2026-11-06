import type { Context, MiddlewareHandler } from 'hono'
import { askInChunks, AT_A_TIME, places } from '../bound'
import { NO_SUCH_SPACE } from '../refused'
import { newId, now } from '../crypto'
import { dnsRecords } from './addresses'
import type { Env, Space, Variables, Whoever } from '../types'
import { readArranged } from './arranged'
import { readBookmarks } from './bookmarks'
import { readExcluded } from './excluded'
import { readArchived } from './archived'
import { readGraph } from './graph'
import { readSort } from './sort'
import { readIcons, readTints } from './icons'
import { presentSite, readSite } from '../blog/site'

export function withoutSetup<T extends ReturnType<typeof presentSpace>>(view: T): T {
  return { ...view, blog: { ...view.blog, dns: [], site: EMPTY_SITE } }
}

const EMPTY_SITE = {
  rules: { include: [], exclude: [], otherwise: 'all' as const },
  password: false,
}

export type Role = 'owner' | 'write' | 'read'

const RANK: Record<Role, number> = { read: 0, write: 1, owner: 2 }

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
    tint: null,
    deleted: 0,
    deleted_at: null,
    created_at: now(),
    updated_at: now(),
    blog_enabled: 0,
    blog_subdomain: null,
    blog_domain: null,
    blog_domain_token: null,
    blog_domain_verified_at: null,
    blog_note: null,
    blog_title: null,
    bookmarks: '[]',
    files: '[]',
    icons: '{}',
    tints: '{}',
    graph: '{}',
    arranged: '{}',
    archived: '{}',
    excluded: '[]',
    site: '{}',
    sort: '',
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

export interface Reached extends Space {
  role: Role
}

const REACHED = `select sp.*,
    case when sp.user_id = ?2 then 'owner' else m.role end as role
  from spaces sp
  left join space_members m on m.space_id = sp.id and m.email = ?3 and m.item = ''
 where sp.id = ?1 and sp.deleted = 0`

const GUEST_REACHED = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?2 and g.item = ''
 where sp.id = ?1 and sp.deleted = 0 and g.joined_at is not null`

const ITEM_REACHED = `select sp.*, m.role as role
  from spaces sp
  join space_members m on m.space_id = sp.id and m.email = ?2 and m.item = ?3
 where sp.id = ?1 and sp.deleted = 0`

const GUEST_ITEM_REACHED = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?2 and g.item = ?3
 where sp.id = ?1 and sp.deleted = 0 and g.joined_at is not null`

export async function reachedSpace(
  env: Env,
  who: Whoever,
  spaceId: string,
): Promise<Reached | null> {
  const row =
    who.kind === 'user'
      ? await env.DB.prepare(REACHED)
          .bind(spaceId, who.user.id, who.user.email)
          .first<Space & { role: string | null }>()
      : await env.DB.prepare(GUEST_REACHED)
          .bind(spaceId, who.guest.id)
          .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

export async function reachedItem(
  env: Env,
  who: Whoever,
  note: { id: string; space_id: string },
): Promise<Reached | null> {
  const row =
    who.kind === 'user'
      ? await env.DB.prepare(ITEM_REACHED)
          .bind(note.space_id, who.user.email, note.id)
          .first<Space & { role: string | null }>()
      : await env.DB.prepare(GUEST_ITEM_REACHED)
          .bind(note.space_id, who.guest.id, note.id)
          .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

export function atLeast(
  needed: Role,
  param = 'id',
): MiddlewareHandler<{
  Bindings: Env
  Variables: Variables
}> {
  return async (context, next) => {
    const asked = context.req.param(param) ?? ''
    const space = await reachedSpace(context.env, context.get('who'), asked)
    if (!space) return context.json({ error: NO_SUCH_SPACE }, 404)
    if (!allows(space.role, needed)) return context.json({ error: refusal(needed) }, 403)

    context.set('space', space)
    await next()
  }
}

export function refusal(needed: Role): string {
  return needed === 'owner' ? 'only the owner can do that' : 'you can only read this space'
}

export function spaceOf(context: Context<{ Bindings: Env; Variables: Variables }>): Reached {
  return context.get('space')
}

export async function sharedAmong(env: Env, spaceIds: readonly string[]): Promise<Set<string>> {
  if (!spaceIds.length) return new Set<string>()

  const found = await askInChunks(
    spaceIds,
    async (chunk) => {
      const list = places(chunk.length)
      const { results } = await env.DB.prepare(
        `select space_id from space_members where space_id in (${list}) and item = ''
       union select space_id from guest_members
        where space_id in (${list}) and item = '' and joined_at is not null`,
      )
        .bind(...chunk, ...chunk)
        .all<{ space_id: string }>()

      return results
    },
    AT_A_TIME / 2,
  )

  return new Set(found.map((row) => row.space_id))
}

export async function onceShared(env: Env, spaceId: string, item = ''): Promise<void> {
  await env.DB.prepare('insert or ignore into once_shared (space_id, item, at) values (?, ?, ?)')
    .bind(spaceId, item, now())
    .run()
}

export async function onceSharedAmong(
  env: Env,
  spaceIds: readonly string[],
): Promise<{ spaces: Set<string>; items: Map<string, string[]> }> {
  const spaces = new Set<string>()
  const items = new Map<string, string[]>()
  if (!spaceIds.length) return { spaces, items }

  const found = await askInChunks(spaceIds, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select space_id, item from once_shared where space_id in (${places(chunk.length)})`,
    )
      .bind(...chunk)
      .all<{ space_id: string; item: string }>()

    return results
  })

  for (const row of found) {
    if (!row.item) {
      spaces.add(row.space_id)
      continue
    }
    const held = items.get(row.space_id) ?? []
    if (held.length < MOST_ITEMS) held.push(row.item)
    items.set(row.space_id, held)
  }

  return { spaces, items }
}

export async function trustAgain(env: Env, spaceId: string): Promise<void> {
  await env.DB.prepare(
    `delete from once_shared
      where space_id = ?1
        and not exists (select 1 from space_members m
                         where m.space_id = ?1 and m.item = once_shared.item)
        and not exists (select 1 from guest_members g
                         where g.space_id = ?1 and g.item = once_shared.item
                           and g.joined_at is not null)`,
  )
    .bind(spaceId)
    .run()
}

export const MOST_ITEMS = 200

export async function itemsSharedIn(
  env: Env,
  spaceIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!spaceIds.length) return out

  const found = await askInChunks(
    spaceIds,
    async (chunk) => {
      const list = places(chunk.length)
      const { results } = await env.DB.prepare(
        `select space_id, item from space_members
          where space_id in (${list}) and item <> ''
         union select space_id, item from guest_members
          where space_id in (${list}) and item <> '' and joined_at is not null`,
      )
        .bind(...chunk, ...chunk)
        .all<{ space_id: string; item: string }>()

      return results
    },
    AT_A_TIME / 2,
  )

  for (const row of found) {
    const held = out.get(row.space_id) ?? []
    if (held.length < MOST_ITEMS && !held.includes(row.item)) held.push(row.item)
    out.set(row.space_id, held)
  }

  return out
}

export async function notesAmong(
  env: Env,
  spaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (!spaceIds.length) return new Map<string, number>()

  const found = await askInChunks(spaceIds, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select space_id, count(*) as notes from notes
        where space_id in (${places(chunk.length)}) and deleted = 0 and kind != 'file'
        group by space_id`,
    )
      .bind(...chunk)
      .all<{ space_id: string; notes: number }>()

    return results
  })

  return new Map(found.map((row) => [row.space_id, row.notes]))
}

export function presentSpace(
  space: Space,
  env: Env,
  role: Role = 'owner',
  shared = false,
  notes = 0,
  sharedItems: readonly string[] = [],
) {
  return {
    id: space.id,
    name: space.name,
    position: space.position,
    icon: space.icon,
    tint: space.tint,
    notes,
    role,
    shared: shared || role !== 'owner',
    sharedItems: [...sharedItems],
    bookmarks: readBookmarks(space.bookmarks),
    icons: readIcons(space.icons),
    tints: readTints(space.tints),
    graph: readGraph(space.graph),
    excluded: readExcluded(space.excluded),
    arranged: readArranged(space.arranged),
    archived: readArchived(space.archived),
    sort: readSort(space.sort),
    createdAt: space.created_at,
    updatedAt: space.updated_at,
    blog: {
      enabled: !!space.blog_enabled,
      subdomain: space.blog_subdomain,
      domain: space.blog_domain,
      title: space.blog_title,
      note: space.blog_note,
      dns: role === 'owner' ? dnsRecords(env, space) : [],
      site: role === 'owner' ? presentSite(readSite(space.site)) : EMPTY_SITE,
    },
  }
}
