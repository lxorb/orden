import type { Input } from '@lezer/common'
import { CommentLines } from '@orden/markdown/comments'
import { frontMatterBlock } from '@orden/markdown/front-matter'

const commentReaders = new WeakMap<Input, { reader: CommentLines; at: number }>()

export function commentStateAt(input: Input, at: number): string | null {
  let held = commentReaders.get(input)
  if (!held || held.at > at) {
    held = {
      reader: new CommentLines(),
      at: frontMatterBlock(input.read(0, input.length))?.to ?? 0,
    }
    commentReaders.set(input, held)
  }
  if (at <= held.at) return held.reader.inside

  const lines = input.read(held.at, at).split('\n')
  lines.pop()
  for (const line of lines) held.reader.line(line)
  held.at = at
  return held.reader.inside
}
