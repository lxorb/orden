import { Hono } from 'hono'
import { askHub, now, opened, readBody, sealed, type Env, type Variables } from '../../../sync-server/src/api'

const MOST = 512 * 1024
const SALT = 'orden/ai-vault/v1'
const STALE = 'stale'
export const aiVault = new Hono<{ Bindings: Env; Variables: Variables }>()
interface Row {
  rev: number
  sealed: string
}
aiVault.get('/accounts', async (context) => {
  const secret = context.env.OPENAI_KEY_SECRET
  if (!secret) return context.json({ error: 'this server cannot keep AI accounts yet' }, 503)
  const user = context.get('user').id
  const row = await context.env.DB.prepare('select rev, sealed from ai_accounts where user_id = ?')
    .bind(user)
    .first<Row>()
  const contents = row ? await opened(secret, user, row.sealed, SALT) : null
  return context.json({ rev: row?.rev ?? 0, contents })
})
aiVault.put('/accounts', async (context) => {
  const secret = context.env.OPENAI_KEY_SECRET
  if (!secret) return context.json({ error: 'this server cannot keep AI accounts yet' }, 503)
  const user = context.get('user').id
  const body = await readBody(context)
  const contents = body.text('contents', MOST) ?? ''
  const rev = body.count('rev') ?? -1
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!contents || !Number.isSafeInteger(rev) || rev < 0) return context.json({ error: 'not AI accounts' }, 400)
  const kept = await sealed(secret, user, contents, SALT)
  const at = now()
  const written =
    rev === 0
      ? await context.env.DB.prepare(
          `insert into ai_accounts (user_id, rev, sealed, updated_at) values (?, 1, ?, ?)
           on conflict(user_id) do nothing`,
        )
          .bind(user, kept, at)
          .run()
      : await context.env.DB.prepare(
          'update ai_accounts set rev = rev + 1, sealed = ?, updated_at = ? where user_id = ? and rev = ?',
        )
          .bind(kept, at, user, rev)
          .run()
  const held = await context.env.DB.prepare('select rev from ai_accounts where user_id = ?')
    .bind(user)
    .first<{ rev: number }>()
  if (!written.meta.changes) return context.json({ error: STALE, rev: held?.rev ?? 0 }, 409)
  await askHub(context.env, user, 'ai').catch(() => null)
  return context.json({ rev: held?.rev ?? rev + 1 })
})
