import { acceptedIn } from '@orden/pass/wire'
import { Hono } from 'hono'
import type { Env, Variables } from '../../sync-server/src/api'
import { membershipOf } from './access'
import { NO_SUCH_INVITE, NOT_A_PROOF, NOT_READY } from './refusals'
import { vaultRowOf } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, tellVault } from './tell'
import { fieldsSent, jsonOf, optionalIn } from './trust-body'

export const invites = new Hono<{ Bindings: Env; Variables: Variables }>()

invites.post('/invites/:vault/accept', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const from = fromOf(context.req.query('from'))
  const accepted = optionalIn((await fieldsSent(context)).accepted, acceptedIn)
  if (accepted === undefined) return context.json({ error: NOT_A_PROOF }, 400)
  const held = await membershipOf(context.env, vault, user.email)
  if (held?.deleted_at !== null || (held.state !== 'pending' && held.state !== 'confirm')) {
    return context.json({ error: NO_SUCH_INVITE }, 404)
  }
  if (held.key === null) return context.json({ error: NOT_READY }, 409)

  const db = context.env.DB
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_members set state = 'active', user_id = ?3, seq = ${SEQ},
                accepted = coalesce(?4, accepted)
          where vault_id = ?1 and email = ?2 and state in ('pending', 'confirm')
            and key is not null
            and key_version = (select key_version from pass_vaults where id = ?1)`,
      )
      .bind(vault, user.email, user.id, jsonOf(accepted)),
  ])
  if (!results[1]?.meta.changes) return context.json({ error: NOT_READY }, 409)
  await tellVault(context.env, vault, [user.id], from)
  const after = await membershipOf(context.env, vault, user.email)
  return context.json({ vault: after && vaultRowOf(after, user.id) })
})

invites.post('/invites/:vault/decline', async (context) => {
  const user = context.get('user')
  const vault = context.req.param('vault')
  const from = fromOf(context.req.query('from'))
  const held = await membershipOf(context.env, vault, user.email)
  if (!held || (held.state !== 'pending' && held.state !== 'confirm')) {
    return context.json({ error: NO_SUCH_INVITE }, 404)
  }
  const db = context.env.DB
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `delete from pass_members
          where vault_id = ? and email = ? and state in ('pending', 'confirm')`,
      )
      .bind(vault, user.email),
    db.prepare(`update pass_vaults set seq = ${SEQ} where id = ?`).bind(vault),
  ])
  if (!results[1]?.meta.changes) return context.json({ error: NO_SUCH_INVITE }, 404)
  await tellVault(context.env, vault, [user.id], from)
  return context.json({ ok: true })
})
