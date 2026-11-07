import { chunks } from '../bound'
import type { Env } from '../types'

export type MachineAsk =
  | 'join'
  | 'start'
  | 'stop'
  | 'state'
  | 'typing'
  | 'revoke'
  | 'signedout'
  | 'end'
  | 'erase'
  | 'restart'
  | 'reboot'
  | 'host'
  | 'sessions'

export async function askMachine(
  env: Env,
  id: string,
  ask: MachineAsk,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const namespace = env.MACHINES
  if (!namespace) return null

  const place =
    typeof namespace.jurisdiction === 'function' && !env.MACHINE_DEV_ORDEND
      ? namespace.jurisdiction('eu')
      : namespace

  for (let asked = 0; asked < 2; asked++) {
    try {
      const machine = place.get(place.idFromName(id))
      return await machine.fetch(
        new Request(`https://machine.invalid/${ask}`, {
          headers: { ...headers, 'x-orden-machine': ask, 'x-orden-id': id },
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

export async function eraseMachines(env: Env, ids: readonly string[]): Promise<string[]> {
  if (!env.MACHINES) return [...ids]

  const emptied: string[] = []
  for (const round of chunks(ids, 20)) {
    const heard = await Promise.all(round.map((id) => askMachine(env, id, 'erase')))
    emptied.push(...round.filter((_, at) => heard[at]?.ok === true))
  }
  return emptied
}
