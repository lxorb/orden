import { chatOf, CHAT_EXTENSION } from '@orden/chats'
import type { Env, Note } from '../types'

export async function linkPointer(env: Env, note: Note, content: string): Promise<void> {
  if (!note.path.toLowerCase().endsWith(CHAT_EXTENSION)) return
  const pointer = chatOf(content)
  if (!pointer) return
  await env.DB.prepare(
    `update chats set file_id = ?1
      where id = ?2 and space_id = ?3 and file_id is null and ended_at is null
        and not exists (select 1 from chats where file_id = ?1)`,
  )
    .bind(note.id, pointer.chat, note.space_id)
    .run()
}
