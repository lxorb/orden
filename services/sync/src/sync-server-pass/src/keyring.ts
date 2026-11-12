import { keyringIn } from '@orden/pass/keyring'
import { isCount, MOST_KEYRING_BYTES } from '@orden/pass/wire'
import { Hono } from 'hono'
import {
  objectBody,
  objectIn,
  isEmail,
  normaliseEmail,
  now,
  within,
  NOT_AN_EMAIL,
  NOT_AN_OBJECT,
  TRY_IN_AN_HOUR,
  type Env,
  type Variables,
} from '../../sync-server/src/api'
import { AT_GOES_ON, KEEPS_ITS_PUB, KEEPS_ITS_SIGN, NOT_A_KEYRING, STALE } from './refusals'
import { keyringRowOf } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, tell } from './tell'

const AN_HOUR = 60 * 60 * 1000
const LOOKUPS_AN_HOUR = 300

interface KeyringDb {
  rev: number
  keyring: string
  pub: string
}

export const keyrings = new Hono<{ Bindings: Env; Variables: Variables }>()

async function keyringOf(env: Env, user: string): Promise<KeyringDb | null> {
  return await env.DB.prepare('select rev, keyring, pub from pass_keyrings where user_id = ?')
    .bind(user)
    .first<KeyringDb>()
}

async function waitingOn(env: Env, email: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `select distinct o.user_id from pass_members m
       join pass_members o on o.vault_id = m.vault_id
      where m.email = ? and m.state = 'confirm' and o.user_id is not null
        and o.state = 'active' and o.role in ('manager', 'owner')`,
  )
    .bind(email)
    .all<{ user_id: string }>()
  return results.map((one) => one.user_id)
}

keyrings.put('/keyring', async (context) => {
  const user = context.get('user')
  const from = fromOf(context.req.query('from'))
  const sent = await objectBody(context)
  if (!sent) return context.json({ error: NOT_AN_OBJECT }, 400)
  const keyring = keyringIn(sent.keyring)
  const rev = sent.rev
  const text = keyring === null ? '' : JSON.stringify(keyring)
  if (keyring === null || !isCount(rev) || text.length > MOST_KEYRING_BYTES) {
    return context.json({ error: NOT_A_KEYRING }, 400)
  }

  const db = context.env.DB
  const held = await keyringOf(context.env, user.id)
  const stale = async () => {
    const current = await keyringOf(context.env, user.id)
    return context.json({ error: STALE, current: current ? keyringRowOf(current) : null }, 409)
  }
  if ((held?.rev ?? 0) !== rev) return await stale()

  if (held === null) {
    const results = await db.batch([
      bump(db),
      db
        .prepare(
          `insert into pass_keyrings (user_id, rev, keyring, pub, sign_pub, updated_at, seq)
           values (?, 1, ?, ?, ?, ?, ${SEQ}) on conflict(user_id) do nothing`,
        )
        .bind(user.id, text, keyring.pub, keyring.sign?.pub ?? null, now()),
      db
        .prepare('update pass_members set user_id = ?1 where email = ?2 and user_id is null')
        .bind(user.id, user.email),
      db
        .prepare(
          `update pass_members set state = 'confirm', seq = ${SEQ}
            where email = ? and state = 'pending' and key is null`,
        )
        .bind(user.email),
    ])
    if (!results[1]?.meta.changes) return await stale()
    await tell(context.env, [user.id, ...(await waitingOn(context.env, user.email))], from)
    return context.json({ rev: 1 })
  }

  const before = keyringIn(objectIn(held.keyring))
  if (held.pub !== keyring.pub) return context.json({ error: KEEPS_ITS_PUB }, 400)
  if (before !== null && keyring.at <= before.at) return context.json({ error: AT_GOES_ON }, 400)
  if (before?.sign && keyring.sign?.pub !== before.sign.pub) {
    return context.json({ error: KEEPS_ITS_SIGN }, 400)
  }

  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_keyrings set rev = rev + 1, keyring = ?, sign_pub = ?, updated_at = ?,
                seq = ${SEQ}
          where user_id = ? and rev = ?`,
      )
      .bind(text, keyring.sign?.pub ?? null, now(), user.id, rev),
  ])
  if (!results[1]?.meta.changes) return await stale()
  await tell(context.env, [user.id], from)
  return context.json({ rev: rev + 1 })
})

keyrings.get('/people/key', async (context) => {
  const user = context.get('user')
  const email = normaliseEmail(context.req.query('email') ?? '')
  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  if (!(await within(context.env, 'pass-people', user.id, LOOKUPS_AN_HOUR, AN_HOUR))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }
  const row = await context.env.DB.prepare(
    `select k.pub, k.sign_pub from users u join pass_keyrings k on k.user_id = u.id
      where u.email = ?`,
  )
    .bind(email)
    .first<{ pub: string; sign_pub: string | null }>()
  return context.json({ pub: row?.pub ?? null, signPub: row?.sign_pub ?? null })
})
