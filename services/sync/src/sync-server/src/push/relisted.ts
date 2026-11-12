import { noteKey } from '../notes'
import type { Env } from '../types'
import { keepReminders } from './reminders'

const AT_ONCE = 50

export async function remindRelisted(
  env: Env,
  spaceId: string,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids.slice(0, AT_ONCE)) {
    const note = await env.DB.prepare(
      'select id, space_id, path, meta from notes where id = ? and space_id = ? and deleted = 0',
    )
      .bind(id, spaceId)
      .first<{ id: string; space_id: string; path: string; meta: string | null }>()
    if (!note) continue
    const object = await env.NOTES.get(noteKey(spaceId, id))
    await keepReminders(env, note, object ? await object.text() : '')
  }
}
