import { chunks } from '../bound'
import type { Env } from '../types'

export type HubAsk = 'join' | 'poke' | 'revoke' | 'erase' | 'machine' | 'terms' | 'chat' | 'ai'

export const HUB_AWAY = 'sync is not answering - try again'

const AT_ONCE = 50

export async function askHub(
  env: Env,
  id: string,
  ask: HubAsk,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const namespace = env.HUB
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const hub = namespace.get(namespace.idFromName(id))
      return await hub.fetch(
        new Request(`https://hub.invalid/${ask}`, { headers: { ...headers, 'x-nib-hub': ask } }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }

  return null
}

export async function eraseHubs(env: Env, ids: readonly string[]): Promise<string[]> {
  if (!env.HUB) return [...ids]

  const emptied: string[] = []
  for (const round of chunks(ids, AT_ONCE)) {
    const heard = await Promise.all(round.map((id) => askHub(env, id, 'erase')))
    emptied.push(...round.filter((_, at) => heard[at]?.ok === true))
  }

  return emptied
}

export async function tellHubs(
  env: Env,
  ids: readonly string[],
  ask: HubAsk,
  headers: Record<string, string>,
): Promise<void> {
  for (const round of chunks(ids, AT_ONCE)) {
    await Promise.all(round.map((id) => askHub(env, id, ask, headers)))
  }
}
