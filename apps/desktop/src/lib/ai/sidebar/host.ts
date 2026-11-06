import { getContext, setContext } from 'svelte'
import type { Host } from './chat.svelte'

const KEY = Symbol('ai-host')

export function setHost(host: Host): void {
  setContext(KEY, host)
}

export function hostHere(): Host {
  return getContext<Host | undefined>(KEY) ?? 'side'
}
