import type { Thread, Turn } from '../chat/types'
import { checkpoints } from './changes'
import { review, type ReviewPanel } from './review.svelte'

export type { ReviewPanel } from './review.svelte'

export function openRewind(thread: Thread, panel: ReviewPanel, turn?: string): void {
  if (thread.turns.length) review.openRewind(thread, panel, turn ?? null)
}

export function lastMessage(thread: Thread): Turn | null {
  return checkpoints(thread.turns).at(-1) ?? null
}

export function editMessage(
  thread: Thread,
  turn: string,
  text: string,
  panel: ReviewPanel,
): Promise<void> {
  return review.edit(thread, turn, text, panel)
}

export function following(thread: Thread): boolean {
  return review.following.has(thread.id)
}

export function toggleFollow(thread: Thread): void {
  review.toggleFollow(thread)
}
