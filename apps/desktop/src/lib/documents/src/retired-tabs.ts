import { isRecord, isString } from '../../platform/src/api'

const RETIRED_CHAT = 'connected-chat\n'

export const isRetiredChat = (chat: string): boolean => chat.startsWith(RETIRED_CHAT)

export const isRetiredTab = (value: unknown): boolean =>
  isRecord(value) &&
  (value.kind === 'connect' ||
    (value.kind === 'channel' && isString(value.doc) && isRetiredChat(value.doc)))

export function holdsRetiredTab(value: unknown): boolean {
  if (isRetiredTab(value)) return true
  if (Array.isArray(value)) return value.some(holdsRetiredTab)
  return isRecord(value) && Object.values(value).some(holdsRetiredTab)
}
