import { isRecord, isString } from '../../platform/src/api'

const RETIRED_CHAT = 'connected-chat\n'
const GONE_KINDS: readonly unknown[] = ['application']
export const isRetiredChat = (chat: string): boolean => chat.startsWith(RETIRED_CHAT)
const isRetiredChatTab = (value: unknown): boolean =>
  isRecord(value) &&
  (value.kind === 'connect' || (value.kind === 'channel' && isString(value.doc) && isRetiredChat(value.doc)))
export const isRetiredTab = (value: unknown): boolean =>
  isRetiredChatTab(value) || (isRecord(value) && GONE_KINDS.includes(value.kind))
export function holdsRetiredTab(value: unknown): boolean {
  if (isRetiredChatTab(value)) return true
  if (Array.isArray(value)) return value.some(holdsRetiredTab)
  return isRecord(value) && Object.values(value).some(holdsRetiredTab)
}
