/** Which models the account may choose, asked of OpenAI rather than guessed.
 *
 *  Model names change every few months and a list written down would be a list of
 *  models that used to exist. So the settings pane asks, the Worker asks OpenAI
 *  with the account's own key, and what comes back is narrowed to the four families
 *  worth putting in front of somebody: `astra`, `sol`, `luna` and `terra`.
 *
 *  Narrowed rather than shown whole because the endpoint answers with a hundred and
 *  twenty five ids, most of them dated snapshots, transcription models, embedding
 *  models and things that cannot hold a conversation at all. A list like that in a
 *  settings pane is not a choice, it is a filing cabinet.
 *
 *  The four families were verified against the endpoint on 2026-09-09: it answered
 *  `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-luna` and `gpt-5.6-terra`. Nothing here
 *  depends on those exact strings; they are what the filter found, and it will find
 *  whatever replaces them.
 *
 *  This used to run in the plugin, with the key on the phone. It is here now
 *  because the key is here now and nowhere else. */

import { listIn } from '../body'
import { now } from '../crypto'
import type { Env } from '../types'

/** The families, in the order they are offered. Newest first, which is also the
 *  order of the reader's likely preference. */
const FAMILIES = ['astra', 'sol', 'luna', 'terra'] as const

/** A dated snapshot of a model, which is never what a settings pane should offer:
 *  a reader who picks one is pinned to it until they notice. */
const DATED = /-\d{4}-\d{2}-\d{2}$/

/** Where the request goes. */
export const OPENAI = 'https://api.openai.com'

/** How long a list is worth keeping. A day: the answer is the same all day, the
 *  pane asks for it every time it is opened, and a model that appears this morning
 *  is worth having by tomorrow. */
const A_DAY = 24 * 60 * 60 * 1000

/** The ids worth offering, out of whatever the endpoint answered.
 *
 *  Read field by field, because this is a boundary: what comes back is JSON from
 *  somebody else's server and is unknown until it has been checked. */
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
    // The shortest id in the family, which is the alias rather than a variant of
    // it: `gpt-5.6-sol` over `gpt-5.6-sol-preview`.
    const found = ids
      .filter((id) => id.endsWith(`-${family}`) || id === family)
      .sort((a, b) => a.length - b.length)
    const first = found[0]
    if (first !== undefined) out.push(first)
  }

  return out
}

/** What was answered before, while it is still worth answering with. */
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

/** The ids the account may choose, in family order, from the cache when there is
 *  one and from OpenAI when there is not.
 *
 *  Answers an empty list rather than throwing: a key that is wrong, an account with
 *  no credit and OpenAI being down are all "no models to offer", and the settings
 *  pane says so in one line rather than in a dialog. An empty answer is not kept,
 *  so a key that starts working is offered its models at once. */
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

/** Forgets what was answered for one account. Called when the key changes: the
 *  list belonged to the old key. */
export async function forgetModels(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('models', userId)
    .run()
}
