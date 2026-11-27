import type { PushQuiet } from '@orden/chats/push'
import { frameWord, method } from '../../platform/src/api'

interface Phone {
  word: () => Promise<string>
  tell: ((said: string, json: string) => void) | undefined
}
export async function tellQuiet(
  quiet: PushQuiet,
  phone: Phone = { word: frameWord, tell: method('pushQuiet') },
): Promise<boolean> {
  if (!phone.tell) return false
  const said = await phone.word()
  if (!said) return false
  try {
    phone.tell(said, JSON.stringify(quiet))
    return true
  } catch {
    return false
  }
}
