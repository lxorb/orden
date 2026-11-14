import type { Thread } from '../../../ai-providers/src/api'
import { review, type ReviewPanel } from './review.svelte'

interface Context {
  thread: Thread | null
  panel: ReviewPanel
}

export function rewind({ thread, panel }: Context): void {
  if (thread?.turns.length) review.openRewind(thread, panel)
}

export function changes({ thread }: Context): void {
  if (thread) review.listing = thread.id
}
