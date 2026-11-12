import type { Role } from '@orden/pass/types'
import {
  type Changes,
  type Invite,
  keyProofIn,
  LONGEST_NAME,
  MOST_PAGE,
  personKeyIn,
  pinIn,
} from '@orden/pass/wire'
import { Hono } from 'hono'
import { objectIn, type Env, type Variables } from '../../sync-server/src/api'
import {
  ITEM_COLUMNS,
  type ItemDb,
  itemRowOf,
  keyringRowOf,
  VAULT_SELECT,
  type VaultDb,
  vaultRowOf,
} from './rows'
import { seqNow } from './seq'

export const changes = new Hono<{ Bindings: Env; Variables: Variables }>()

interface InviteDb {
  vault_id: string
  role: Role
  key: string | null
  meta: string
  from_email: string | null
  from_name: string | null
  key_version: number
  from_pub: string | null
  from_sign_pub: string | null
  key_proof: string | null
  pin: string | null
}

function sinceIn(raw: string | undefined): number | null {
  const since = Number(raw ?? '0')
  return Number.isSafeInteger(since) && since >= 0 ? since : null
}

changes.get('/changes', async (context) => {
  const user = context.get('user')
  const since = sinceIn(context.req.query('since'))
  if (since === null) return context.json({ error: 'since must be a whole number' }, 400)

  const env = context.env
  const top = await seqNow(env.DB)
  const { results: rows } = await env.DB.prepare(
    `select ${ITEM_COLUMNS.split(', ')
      .map((one) => `i.${one}`)
      .join(', ')}, i.seq
       from pass_items i
      where i.vault_id in (select m.vault_id from pass_members m
                             join pass_vaults v on v.id = m.vault_id
                            where m.email = ?1 and m.state = 'active' and v.deleted_at is null)
        and i.seq > ?2 and i.seq <= ?3
      order by i.seq limit ?4`,
  )
    .bind(user.email, since, top, MOST_PAGE + 1)
    .all<ItemDb & { seq: number }>()

  const more = rows.length > MOST_PAGE
  const page = rows.slice(0, MOST_PAGE)
  const seq = more ? (page[page.length - 1]?.seq ?? since) : top

  const [vaults, keyring, invites] = await Promise.all([
    env.DB.prepare(
      `${VAULT_SELECT}
        where m.email = ?1 and m.state in ('active', 'removed')
          and (v.seq > ?2 or m.seq > ?2)`,
    )
      .bind(user.email, since)
      .all<VaultDb>(),
    env.DB.prepare('select keyring, rev from pass_keyrings where user_id = ? and seq > ?')
      .bind(user.id, since)
      .first<{ keyring: string; rev: number }>(),
    env.DB.prepare(
      `select m.vault_id, m.role, m.key, v.meta, u.email as from_email, u.name as from_name,
              m.key_version, k.pub as from_pub, k.sign_pub as from_sign_pub, v.key_proof, m.pin
         from pass_members m
         join pass_vaults v on v.id = m.vault_id
         left join users u on u.id = m.invited_by
         left join pass_keyrings k on k.user_id = m.invited_by
        where m.email = ? and m.state in ('pending', 'confirm') and v.deleted_at is null
        order by m.vault_id`,
    )
      .bind(user.email)
      .all<InviteDb>(),
  ])

  const answer: Changes = {
    seq,
    more,
    keyring: keyring ? keyringRowOf(keyring) : null,
    vaults: vaults.results.map((one) => vaultRowOf(one, user.id)),
    items: page.map(itemRowOf),
    invites: invites.results.map((one): Invite => ({
      vault: one.vault_id,
      from: one.from_email ?? '',
      fromName: (one.from_name ?? '').slice(0, LONGEST_NAME),
      role: one.role,
      key: one.key,
      meta: one.meta,
      keyVersion: one.key_version,
      fromKey: personKeyIn({ pub: one.from_pub, signPub: one.from_sign_pub }),
      proof: keyProofIn(objectIn(one.key_proof)),
      pin: pinIn(objectIn(one.pin)),
    })),
  }
  return context.json(answer)
})
