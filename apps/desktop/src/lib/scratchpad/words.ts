export function joined(first: string, second: string): string {
  const head = first.replace(/\s+$/, '')
  const tail = second.trim()
  if (!tail) return first
  if (!head) return `${tail}\n`
  return `${head}\n\n${tail}\n`
}

export function difference(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  const most = Math.min(before.length, after.length)
  let head = 0
  while (head < most && before[head] === after[head]) head++
  let tail = 0
  while (tail < most - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++

  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }
}
