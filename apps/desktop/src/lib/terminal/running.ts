import { runs } from '../parting'

const running = new Map<string, string>()
runs(() => running.size > 0)

export function ptyOf(tabId: string): string | undefined {
  return running.get(tabId)
}

export function runningTabs(): string[] {
  return [...running.keys()]
}

export function setPty(tabId: string, pty: string | null): void {
  if (pty === null) running.delete(tabId)
  else running.set(tabId, pty)
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
const live = new Set<string>()

export function setLive(tabId: string, on: boolean): void {
  if (on) live.add(tabId)
  else live.delete(tabId)
}

export function shellRunning(tabId: string): boolean {
  return running.has(tabId) || live.has(tabId)
}
