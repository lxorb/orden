import { answer, frameWord, method } from '../../platform/src/api'
import type { ChatNav } from './nav.svelte'

export interface Handed {
  link: string
  reply: string
}
interface Listed {
  id: string
  space: string
}
interface Store {
  readonly ready: boolean
  readonly list: readonly Listed[]
  post(chat: string, draft: { body: string }): Promise<unknown>
}
const PATIENCE = 8000
export function handedOf(json: string): Handed {
  let said: unknown
  try {
    said = JSON.parse(json)
  } catch {
    said = null
  }
  const held = typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : {}
  const words = (value: unknown) => (typeof value === 'string' ? value : '')
  return { link: words(held.link), reply: words(held.reply) }
}
export async function openHanded(
  handed: Handed,
  nav: ChatNav,
  chats: Store,
  waited: (ms: number) => Promise<void> = (ms) => new Promise((settle) => setTimeout(settle, ms)),
): Promise<boolean> {
  if (!handed.link) return false
  for (let spent = 0; !chats.ready && spent < PATIENCE; spent += 100) await waited(100)
  if (!nav.follow(handed.link, chats.list) || nav.chat === null) return false
  const reply = handed.reply.trim()
  if (reply) await chats.post(nav.chat, { body: reply })
  return true
}
export function watchHanded(nav: ChatNav, chats: Store): () => void {
  const read = method('handed')
  if (!read) return () => undefined
  const look = async () => {
    const said = await frameWord()
    if (said) await openHanded(handedOf(read(said)), nav, chats)
  }
  answer('__ordenHanded', () => void look())
  void look()
  return () => answer('__ordenHanded', undefined)
}
