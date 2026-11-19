import type { Input } from '@lezer/common'
import { CommentLines } from '@orden/markdown/comments'
import { frontMatterBlock } from '@orden/markdown/front-matter'

const commentReaders = new WeakMap<Input, { reader: CommentLines; at: number }>()
const sameStart = new WeakMap<Input, { before: Input; upTo: number }>()
export function sameTextUpTo(input: Input, before: Input, upTo: number): void {
  sameStart.set(input, { before, upTo })
}
function frontMatterEnd(input: Input): number {
  const opening = input.read(0, Math.min(4, input.length))
  if (!opening.startsWith('---') && !opening.startsWith('\uFEFF---')) return 0
  return frontMatterBlock(input.read(0, input.length))?.to ?? 0
}
function readerFor(input: Input, at: number): { reader: CommentLines; at: number } {
  const same = sameStart.get(input)
  const earlier = same ? commentReaders.get(same.before) : undefined
  if (same && earlier && earlier.at <= same.upTo && earlier.at <= at) {
    return { reader: earlier.reader.copy(), at: earlier.at }
  }
  return { reader: new CommentLines(), at: frontMatterEnd(input) }
}
export function commentStateAt(input: Input, at: number): string | null {
  let held = commentReaders.get(input)
  if (!held || held.at > at) {
    held = readerFor(input, at)
    commentReaders.set(input, held)
  }
  if (at <= held.at) return held.reader.inside
  const lines = input.read(held.at, at).split('\n')
  lines.pop()
  for (const line of lines) held.reader.line(line)
  held.at = at
  return held.reader.inside
}
