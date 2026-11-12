import { DEVICE, tellHubs, type Env } from '../../sync-server/src/api'
export function fromOf(query: string | undefined): string {
  return query !== undefined && DEVICE.test(query) ? query : ''
}

export async function membersOf(env: Env, vault: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `select distinct user_id from pass_members
      where vault_id = ? and user_id is not null and state <> 'removed'`,
  )
    .bind(vault)
    .all<{ user_id: string }>()
  return results.map((one) => one.user_id)
}

export async function tell(env: Env, users: readonly string[], from: string): Promise<void> {
  await tellHubs(env, [...new Set(users)], 'pass', { 'x-orden-from': from }).catch(() => undefined)
}

export async function tellVault(
  env: Env,
  vault: string,
  also: readonly string[],
  from: string,
): Promise<void> {
  await tell(env, [...(await membersOf(env, vault)), ...also], from)
}
