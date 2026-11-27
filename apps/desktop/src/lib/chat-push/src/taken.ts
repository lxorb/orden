import { isChatId } from '@orden/chats'
import { frameWord, method } from '../../platform/src/api'

export interface Taken {
  chat: string
  seq: number
}
export function takenOf(json: string): Taken[] {
  let said: unknown
  try {
    said = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(said)) return []
  return said.flatMap((one: unknown): Taken[] => {
    if (typeof one !== 'object' || one === null) return []
    const { chat, seq } = one as Record<string, unknown>
    return isChatId(chat) && typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 ? [{ chat, seq }] : []
  })
}
function handedOver(read: () => string): string {
  try {
    return read()
  } catch {
    return ''
  }
}
export function watchTaken(mark: (chat: string, seq: number) => void): () => void {
  const read = method('pushTaken')
  if (!read) return () => undefined
  const take = async () => {
    const said = await frameWord()
    for (const one of takenOf(said ? handedOver(() => read(said)) : '')) mark(one.chat, one.seq)
  }
  const seen = () => {
    if (document.visibilityState === 'visible') void take()
  }
  document.addEventListener('visibilitychange', seen)
  void take()
  return () => document.removeEventListener('visibilitychange', seen)
}
export async function clearPushed(chat: string): Promise<void> {
  const clear = method('pushClear')
  if (!clear) return
  const said = await frameWord()
  if (!said) return
  try {
    clear(said, chat)
  } catch {
    return
  }
}
