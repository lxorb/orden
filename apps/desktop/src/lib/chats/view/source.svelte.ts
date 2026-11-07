import type { Chats } from '../api'
import { remoteOf } from '../remotes'
import { routed } from '../routed'
import { chats } from '../store.svelte'

let current = $state.raw<Chats>(chats)
const fronts = new WeakMap<Chats, Chats>()

export function store(): Chats {
  let front = fronts.get(current)
  if (!front) {
    front = routed(current, remoteOf)
    fronts.set(current, front)
  }
  return front
}

export function useStore(next: Chats): void {
  current = next
}
