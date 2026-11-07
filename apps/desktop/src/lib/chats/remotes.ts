import { conversationKeyOf } from './conversation-key'
import type { Remote } from './remote.svelte'

const held = new Map<string, Remote>()

function keyOf(provider: string, account: string): string {
  return `${provider}\n${account}`
}

export function keepRemote(remote: Remote): void {
  held.set(keyOf(remote.provider, remote.account), remote)
}

export function dropRemote(provider: string, account: string): void {
  held.get(keyOf(provider, account))?.close()
  held.delete(keyOf(provider, account))
}

export function remoteOf(chat: string): Remote | null {
  const key = conversationKeyOf(chat)
  return key ? (held.get(keyOf(key.provider, key.account)) ?? null) : null
}

export function isRemote(chat: string): boolean {
  return conversationKeyOf(chat) !== null
}
