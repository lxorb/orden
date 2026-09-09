/** Walking a list of choices with the keyboard.
 *
 *  Out of the component because the rule that matters here is not about markup:
 *  the row a keystroke chooses is the row the keyboard walked to, and never one
 *  the pointer merely passed over.
 *
 *  The dropdown shared one cursor between the mouse and the keys, and a hover
 *  moved it. So reading a list with the pointer and then pressing Space chose
 *  whatever the pointer had last crossed - which in the keyboard list is Vim, and
 *  choosing that turns modal editing on for every device on the account. Nobody
 *  had chosen anything. See Select.svelte. */

/** Letters typed in a row, and the moment the last one landed. Spelling a name
 *  is how every list in the app is walked, so the accumulating is here rather
 *  than in each of them; see roving.ts, which spells the file list. */
export interface Spelling {
  typed: string
  typedAt: number
}

/** Where the keyboard is in a list, and what it has been spelling. */
export interface Walk extends Spelling {
  /** The row the keyboard is on, or null while it is on none: an empty list, or
   *  a value the list does not hold. A keystroke chooses nothing from null. */
  cursor: number | null
}

/** What one keystroke does to the list. */
export interface Step {
  walk: Walk
  /** Whether the keystroke was the list's rather than the page's. What the
   *  component reads to decide whether to swallow it. */
  took: boolean
  /** The row it chose, where it chose one. */
  chose?: number
  /** Whether the list should close. */
  shut?: boolean
}

/** How long letters typed in a row count as one word. */
const SPELLING = 600

/** What one letter comes to: the word being spelled, and the first row that
 *  starts with it. `found` is -1 where no row does, which leaves the keyboard
 *  where it was rather than moving it somewhere arbitrary.
 *
 *  A letter after a pause starts a fresh word: the pause is how a hand says it
 *  has stopped spelling one name and started another. */
export function spelled(
  from: Spelling,
  key: string,
  at: number,
  labels: readonly string[],
): Spelling & { found: number } {
  const typed = (at - from.typedAt > SPELLING ? '' : from.typed) + key.toLowerCase()
  const found = labels.findIndex((one) => one.trim().toLowerCase().startsWith(typed))

  return { typed, typedAt: at, found }
}

/** The list as it opens: on the row the value is, or on none where the list does
 *  not hold it. Nothing is spelled yet. */
export function opensAt(index: number): Walk {
  return { cursor: index >= 0 ? index : null, typed: '', typedAt: 0 }
}

/** One keystroke against an open list. `labels` is what each row reads as, which
 *  is what typing a letter looks through; `at` is the event's own timestamp. */
export function walk(key: string, at: number, labels: string[], from: Walk): Step {
  const stay = { ...from }
  if (!labels.length) return { walk: stay, took: false }

  const last = labels.length - 1
  const onto = (cursor: number): Step => ({ walk: { ...stay, cursor }, took: true })

  switch (key) {
    case 'ArrowDown':
      return onto(from.cursor === null ? 0 : (from.cursor + 1) % labels.length)
    case 'ArrowUp':
      return onto(from.cursor === null ? last : (from.cursor - 1 + labels.length) % labels.length)
    case 'Home':
      return onto(0)
    case 'End':
      return onto(last)
    case 'Enter':
    case ' ':
      // Taken either way, so the page underneath does not scroll on a space that
      // was meant for the list. Nothing chosen where the keyboard is on no row.
      return from.cursor === null
        ? { walk: stay, took: true, shut: true }
        : { walk: stay, took: true, chose: from.cursor, shut: true }
    case 'Tab':
      // Not taken: the focus is on its way somewhere, and the list only gets out
      // of the way.
      return { walk: stay, took: false, shut: true }
    default: {
      if (key.length !== 1) return { walk: stay, took: false }

      const { typed, typedAt, found } = spelled(from, key, at, labels)

      return { walk: { cursor: found >= 0 ? found : from.cursor, typed, typedAt }, took: true }
    }
  }
}
