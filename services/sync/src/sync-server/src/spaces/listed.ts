import type { Env } from '../types'

const MOST_SPACES = 500

export interface ListedSpace {
  id: string
  name: string
  role: 'owner' | 'write' | 'read'
  user_id: string
  shared: boolean
  items: boolean
}

export async function spacesFor(env: Env, userId: string): Promise<ListedSpace[]> {
  const { results } = await env.DB.prepare(
    `select sp.id, sp.name, sp.user_id,
        case when sp.user_id = ?1 then 'owner' else m.role end as role,
        (sp.user_id <> ?1
          or exists (select 1 from space_members o where o.space_id = sp.id and o.item = '')
          or exists (select 1 from guest_members g where g.space_id = sp.id and g.item = ''
                      and g.joined_at is not null)
          or exists (select 1 from once_shared x where x.space_id = sp.id and x.item = '')) as shared,
        (exists (select 1 from space_members o where o.space_id = sp.id and o.item <> '')
          or exists (select 1 from guest_members g where g.space_id = sp.id and g.item <> ''
                      and g.joined_at is not null)
          or exists (select 1 from once_shared x where x.space_id = sp.id and x.item <> '')) as items
      from spaces sp
      left join space_members m
        on m.space_id = sp.id and m.item = ''
       and m.email = (select email from users where id = ?1)
     where sp.deleted = 0 and (sp.user_id = ?1 or m.role is not null)
     order by sp.name limit ?2`,
  )
    .bind(userId, MOST_SPACES)
    .all<Omit<ListedSpace, 'shared' | 'items'> & { shared: number; items: number }>()

  return results.map((row) => ({ ...row, shared: !!row.shared, items: !!row.items }))
}
