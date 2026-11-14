import { getContext, setContext } from 'svelte'
import type { ChatHost } from './chat-parts'

const KEY = Symbol('ai-host')

export function setHost(host: ChatHost): void {
  setContext(KEY, host)
}

export function hostHere(): ChatHost {
  return getContext<ChatHost | undefined>(KEY) ?? 'side'
}
