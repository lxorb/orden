import { type Env, now, type Space } from '../../../sync-server/src/api'
import { changeTree } from './tree'

export async function prepareSpace(env: Env, spaceId: string, device?: string): Promise<number> {
  const { cursor } = await changeTree(env, spaceId, device, () => undefined)
  await env.DB.prepare('update spaces set prepared_at = ? where id = ? and prepared_at is null')
    .bind(now(), spaceId)
    .run()
  return cursor
}
export async function preparedSpace(env: Env, space: Space, device?: string): Promise<void> {
  if (space.prepared_at) return
  await prepareSpace(env, space.id, device)
}
