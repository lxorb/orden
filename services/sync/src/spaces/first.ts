import { addNote } from '../notes'
import type { Env } from '../types'
import { addSpace } from './space'
import { welcomeNote } from './welcome'

const SPACE = 'Notes'
const NOTE = 'Read me.md'
const ICON = 'NotebookPen'

export async function makeFirstSpace(
  env: Env,
  userId: string,
  accepted: string | undefined,
): Promise<void> {
  const held = await env.DB.prepare('select id from spaces where user_id = ? and deleted = 0')
    .bind(userId)
    .first<{ id: string }>()

  if (held) return

  const space = await addSpace(env, userId, SPACE, ICON)
  await addNote(env, space.id, NOTE, welcomeNote(accepted))
}
