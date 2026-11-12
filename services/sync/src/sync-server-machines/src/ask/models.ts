import { listIn, now, type Env } from '../../../sync-server/src/api'
const FAMILIES = ['astra', 'sol', 'luna', 'terra'] as const

const DATED = /-\d{4}-\d{2}-\d{2}$/

export const OPENAI = 'https://api.openai.com'

const A_DAY = 24 * 60 * 60 * 1000

function chosenOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []

  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const ids = data
    .map((one) =>
      typeof one === 'object' && one !== null && typeof (one as { id?: unknown }).id === 'string'
        ? (one as { id: string }).id
        : '',
    )
    .filter((id) => id !== '' && !DATED.test(id))

  const out: string[] = []
  for (const family of FAMILIES) {
    const found = ids
      .filter((id) => id.endsWith(`-${family}`) || id === family)
      .sort((a, b) => a.length - b.length)
    const first = found[0]
    if (first !== undefined) out.push(first)
  }

  return out
}

async function kept(env: Env, userId: string): Promise<string[] | null> {
  await env.DB.prepare('delete from cached where until < ?').bind(now()).run()

  const row = await env.DB.prepare('select value from cached where scope = ? and key = ?')
    .bind('models', userId)
    .first<{ value: string }>()
  if (!row) return null

  const held = listIn(row.value)
  if (!held) return null

  return held.every((one): one is string => typeof one === 'string') ? held : null
}

async function keep(env: Env, userId: string, models: string[]): Promise<void> {
  await env.DB.prepare(
    `insert into cached (scope, key, value, until) values (?1, ?2, ?3, ?4)
     on conflict(scope, key) do update set value = ?3, until = ?4`,
  )
    .bind('models', userId, JSON.stringify(models), now() + A_DAY)
    .run()
}

export async function modelsFor(env: Env, userId: string, key: string): Promise<string[]> {
  const already = await kept(env, userId)
  if (already) return already

  const answered = await fetch(`${OPENAI}/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  }).catch(() => null)
  if (!answered?.ok) return []

  const body: unknown = await answered.json().catch(() => null)
  const models = chosenOf(body)
  if (models.length) await keep(env, userId, models)

  return models
}

export async function forgetModels(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('models', userId)
    .run()
}
