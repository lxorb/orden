export type ContextKind = 'selection' | 'note' | 'page'

export function insertion(
  doc: string,
  at: number,
  answer: string,
): { from: number; insert: string; caret: number } {
  const end = doc.indexOf('\n', Math.min(Math.max(at, 0), doc.length))
  const from = end === -1 ? doc.length : end
  const words = answer.trim()

  const before = doc.slice(0, from)
  const after = doc.slice(from)
  const lead = before.trim() ? '\n'.repeat(2 - breaks(/\n*$/, before)) : ''
  const trail = after.trim() ? '\n'.repeat(2 - breaks(/^\n*/, after)) : ''

  const insert = `${lead}${words}${trail}`
  return { from, insert, caret: from + lead.length + words.length }
}

function breaks(at: RegExp, text: string): number {
  return Math.min(2, at.exec(text)?.[0].length ?? 0)
}

export function carried(before: string, after: string, at: number): number {
  const most = Math.min(before.length, after.length)
  let head = 0
  while (head < most && before.charCodeAt(head) === after.charCodeAt(head)) head++
  if (at <= head) return at
  let tail = 0
  while (
    tail < most - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  )
    tail++
  return at >= before.length - tail ? at + after.length - before.length : after.length - tail
}
