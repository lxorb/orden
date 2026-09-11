/** What the search is holding, and how to say it in one line.
 *
 *  Both builds keep the space they search in memory rather than reading it again
 *  per keystroke - the browser in its worker, the app in the crate - and both can
 *  be asked the same four questions about what they are holding: how many notes,
 *  how much text, against what cap, and whether a whole pass has finished. One
 *  shape for both answers, so the twins cannot drift apart and so one line of
 *  diagnostics reads the same wherever it came from.
 *
 *  Its own module because three places want it and none of them may import the
 *  others: the worker's cache, the page's store, and the panel that carries the
 *  line. See web/space-cache.ts, warm.svelte.ts and `warmth` in search.rs. */

/** How much of a space is held. */
export interface Warmth {
  /** Notes held with their words. */
  notes: number
  /** Notes the space has, whether they are held or not. */
  of: number
  /** Characters of note text held, the folded copies included. */
  characters: number
  /** The most it will hold. Past this the largest notes go first and are read
   *  again when a search next reaches them. */
  cap: number
  /** Notes the cap has pushed out since the space opened. */
  dropped: number
  /** Notes read since the space opened: the whole space once, and after that only
   *  the ones that changed or that the cap let go of. Counted rather than timed,
   *  for the reason fuzzy.ts gives beside its own counters, and asserted rather
   *  than a clock in space-cache.test.ts. */
  read: number
  /** Whether a whole pass over the space has finished, which is what makes the
   *  next search read nothing. */
  warm: boolean
}

/** Whether something that crossed a boundary is one of these. A number that did
 *  not arrive is nothing to fail over, so a shape that is not this reads as
 *  nothing held. */
export function isWarmth(value: unknown): value is Warmth {
  if (typeof value !== 'object' || value === null) return false

  const shape = value as Partial<Record<keyof Warmth, unknown>>
  return (
    typeof shape.notes === 'number' &&
    typeof shape.of === 'number' &&
    typeof shape.characters === 'number' &&
    typeof shape.cap === 'number' &&
    typeof shape.dropped === 'number' &&
    typeof shape.read === 'number' &&
    typeof shape.warm === 'boolean'
  )
}

/** And how much of the papers beside those notes is held, which is the other half
 *  of what a search reads; see pdf/papers.ts. */
export interface PapersHeld {
  /** Papers with words to search. */
  papers: number
  characters: number
  cap: number
}

/** One line of both, as the search panel carries it and a drive reads it back.
 *
 *  Key and value, because the only readers are a profiler, a drive and whoever is
 *  looking into why a search felt slow. Nothing here is shown to anybody, so
 *  nothing here goes through `t()`. */
export function said(warmth: Warmth | null, papers: PapersHeld | null): string | undefined {
  if (!warmth && !papers) return undefined

  const words = []
  if (warmth) {
    const { notes, of, characters, cap, dropped, read, warm } = warmth
    words.push(
      `notes=${notes}/${of}`,
      `chars=${characters}/${cap}`,
      `dropped=${dropped}`,
      `read=${read}`,
      `warm=${warm ? 1 : 0}`,
    )
  }

  if (papers) words.push(`papers=${papers.papers}`, `pchars=${papers.characters}/${papers.cap}`)

  return words.join(' ')
}
