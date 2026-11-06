export function paragraphWindow(src: string): number {
  for (let at = 0; ;) {
    const end = src.indexOf('\n', at)
    if (end === -1) return src.length

    let next = end + 1
    while (next < src.length && (src[next] === ' ' || src[next] === '\t')) next++

    if (next >= src.length) return src.length
    if (src[next] === '\n' || src[next] === '\r') return next + 1

    at = next
  }
}

export function firstStart(
  src: string,
  needles: readonly string[],
  place: (src: string, at: number) => number | null,
): number | undefined {
  const end = paragraphWindow(src)
  const window = end >= src.length ? src : src.slice(0, end)
  let found: number | undefined

  for (const needle of needles) {
    for (let at = window.indexOf(needle); at !== -1; at = window.indexOf(needle, at + 1)) {
      const start = place(src, at)
      if (start === null) continue

      if (found === undefined || start < found) found = start
      break
    }
  }

  return found
}

export function lineStart(
  src: string,
  at: number,
  options: { blanks?: number; orString?: boolean } = {},
): number | null {
  const blanks = options.blanks ?? 0

  let start = at
  while (start > 0 && at - start < blanks && isBlank(src[start - 1])) start--

  if (start === 0) return options.orString === true ? 0 : null
  return src[start - 1] === '\n' ? start - 1 : null
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

export function matchesAt(pattern: RegExp, src: string, at: number): boolean {
  pattern.lastIndex = at
  return pattern.test(src)
}
