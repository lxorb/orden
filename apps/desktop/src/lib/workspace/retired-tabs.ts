import { isRecord, isString } from '../stored'

const RETIRED_CHAT = 'connected-chat\n'

export function isRetiredChat(chat: string): boolean {
  return chat.startsWith(RETIRED_CHAT)
}

export function isRetiredTab(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'connect' ||
      (value.kind === 'channel' && isString(value.doc) && isRetiredChat(value.doc)))
  )
}

export function holdsRetiredTab(value: unknown): boolean {
  if (isRetiredTab(value)) return true
  if (Array.isArray(value)) return value.some(holdsRetiredTab)
  return isRecord(value) && Object.values(value).some(holdsRetiredTab)
}
