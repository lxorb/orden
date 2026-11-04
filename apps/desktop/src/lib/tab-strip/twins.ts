/** Which tabs drawn as their mark alone would look the same (#1041): two notes that chose
 *  no icon of their own are two identical pages, three tabs of one site three identical
 *  pictures. Each of those wears the first letter of its name on its mark as well, so a
 *  strip of icons is still a strip somebody can tell apart without pointing at each one.
 *  Pure. */

/** A tab as this reads it: what it looks like as an icon, or null where its look is its
 *  own - a chosen icon, a terminal's program, the graph. */
export interface Looked {
  readonly id: string
  readonly look: string | null
}

/** The tabs whose look another tab of the strip shares. */
export function twins(tabs: readonly Looked[]): Set<string> {
  const seen = new Map<string, number>()
  for (const one of tabs) if (one.look !== null) seen.set(one.look, (seen.get(one.look) ?? 0) + 1)
  return new Set(
    tabs.filter((one) => one.look !== null && (seen.get(one.look) ?? 0) > 1).map((one) => one.id),
  )
}

/** The first letter of a name, as a capital: the first thing in it that is a letter or a
 *  digit, so a name that starts with an emoji or a bracket still says something. */
export function initialOf(name: string): string {
  // By what a reader counts as one character, so an accented letter or a flag stays whole.
  const marks = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)]
  const letter = marks.find((one) => /^[\p{L}\p{N}]/u.test(one.segment))
  return (letter ?? marks[0])?.segment.toLocaleUpperCase() ?? ''
}

/** What a site's tabs look like: its host, which its picture is of. */
export function siteLook(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    return `web:${new URL(address).host}`
  } catch {
    return null
  }
}
