import type { Hit } from '../shapes'
import { store } from './source.svelte'

const MOST = 50
export async function messagesFor(words: string): Promise<Hit[]> {
  const asked = words.trim()
  const chats = store()
  if (!asked || !chats.ready) return []
  const found = await chats.search(asked).catch((): Hit[] => [])
  return found.filter((one) => !one.message.deleted).slice(0, MOST)
}
