/** What a tab of another service's conversation keeps as its words (#321). */

const HEAD = 'connected-chat\n'

export interface ConversationKey {
  provider: string
  account: string
  conversation: string
}

export function conversationKey(key: ConversationKey): string {
  return `${HEAD}${key.provider}\n${key.account}\n${key.conversation}`
}

export function conversationKeyOf(text: string): ConversationKey | null {
  if (!text.startsWith(HEAD)) return null
  const [provider, account, ...rest] = text.slice(HEAD.length).split('\n')
  const conversation = rest.join('\n')
  return provider && account && conversation ? { provider, account, conversation } : null
}
