export function lineStarts(body: string): number[] {
  const starts = [0]
  for (let at = body.indexOf('\n'); at !== -1; at = body.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }

  return starts
}

export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }

  return low
}
