import { unshow } from '../notify'

const looking = new Map<string, number>()

export function onScreen(chat: string): () => void {
  looking.set(chat, (looking.get(chat) ?? 0) + 1)
  unshow(chat)
  return () => {
    const left = (looking.get(chat) ?? 1) - 1
    if (left > 0) looking.set(chat, left)
    else looking.delete(chat)
  }
}

export function inFront(chat: string): boolean {
  return (
    (looking.get(chat) ?? 0) > 0 && document.visibilityState === 'visible' && document.hasFocus()
  )
}
