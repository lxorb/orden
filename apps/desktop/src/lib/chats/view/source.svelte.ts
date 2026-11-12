import type { Chats } from '../api'
import { chats } from '../store.svelte'

let current = $state.raw<Chats>(chats)

export function store(): Chats {
  return current
}

export function useStore(next: Chats): void {
  current = next
}
