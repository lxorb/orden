import type { tl } from '@mtcute/core'

export const MOST_TEXT = 4096

export interface Piece {
  message: string
  entities: tl.TypeMessageEntity[]
}

function cutAt(text: string, start: number, most: number): number {
  const end = start + most
  if (end >= text.length) return text.length
  const floor = start + Math.floor(most / 2)
  for (const mark of ['\n\n', '\n', ' ']) {
    const at = text.lastIndexOf(mark, end - mark.length)
    if (at >= floor) return at + mark.length
  }
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end
}

export function piecesOf(
  message: string,
  entities: readonly tl.TypeMessageEntity[],
  most = MOST_TEXT,
): Piece[] {
  if (message.length <= most) return [{ message, entities: [...entities] }]
  const out: Piece[] = []
  let start = 0
  while (start < message.length) {
    const end = cutAt(message, start, most)
    const text = message.slice(start, end)
    const begin = start + text.length - text.trimStart().length
    const kept = text.trim()
    const stop = begin + kept.length
    const marks = entities.flatMap((one) => {
      const from = Math.max(one.offset, begin)
      const to = Math.min(one.offset + one.length, stop)
      return to > from ? [{ ...one, offset: from - begin, length: to - from }] : []
    })
    if (kept) out.push({ message: kept, entities: marks })
    start = end
  }
  return out
}
