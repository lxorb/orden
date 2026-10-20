/** Where a block construct could begin, found without reading the rest of the
 *  document for every paragraph in it.
 *
 *  Every block extension hands marked a `start`: the earliest place its construct
 *  could begin in what is left of the document. Marked asks all of them again for
 *  every paragraph it meets, and it hands each of them the whole tail, so a
 *  `start` that reads what it is given costs the render a pass per paragraph.
 *  That is quadratic: on a 500 KB note it was 400 of the 900 ms a render took,
 *  and it grew faster than the note did.
 *
 *  Two things bring it back to one pass. The tail is only read as far as the
 *  paragraph marked is about to make of it, which is all a `start` can change:
 *  marked uses the answer to cut that paragraph short, and a paragraph ends at
 *  the next blank line whatever is written after it. Anything further along is
 *  met by the tokenizer at the next block anyway. And within that window the
 *  construct is looked for as the literals it must contain, which is a byte scan
 *  rather than a regular expression, with the pattern confirming the few
 *  characters around each place they turn up. */

/** Just past the blank line that ends the paragraph about to be read, or the end
 *  of what is left when there is none. A `start` past this cannot matter. */
export function paragraphWindow(src: string): number {
  for (let at = 0; ;) {
    const end = src.indexOf('\n', at)
    if (end === -1) return src.length

    // A line of nothing but blanks ends the paragraph as an empty one does.
    let next = end + 1
    while (next < src.length && (src[next] === ' ' || src[next] === '\t')) next++

    if (next >= src.length) return src.length
    if (src[next] === '\n' || src[next] === '\r') return next + 1

    at = next
  }
}

/** The first place any of `needles` appears that `place` accepts, as the index
 *  `place` answers with: a construct that has to begin a line starts at the
 *  newline before it, which is where the pattern this replaces matched from.
 *
 *  The needles are looked for in the paragraph only; each candidate is then given
 *  to `place` against the whole of `src`, because a construct that begins inside
 *  the paragraph may well run past it - a `$$` block does.
 *
 *  Undefined when there is none, which marked reads as "not in what is left". */
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

      // Each needle is scanned on its own, so the earliest of their answers is
      // the one a single pattern would have come back with.
      if (found === undefined || start < found) found = start
      break
    }
  }

  return found
}

/** The newline that begins the line `at` sits on, when nothing but up to `blanks`
 *  blanks comes between the two. Null when something else does.
 *
 *  `orString` for a pattern that matched from `^` as well as from a newline: then
 *  the start of the string is a line start too, and is answered with 0, which is
 *  where such a pattern reported it. */
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

/** Whether `pattern` matches at exactly `at`. The pattern has to be sticky, and
 *  is left with its `lastIndex` wherever this put it: nothing else reads it. */
export function matchesAt(pattern: RegExp, src: string, at: number): boolean {
  pattern.lastIndex = at
  return pattern.test(src)
}
