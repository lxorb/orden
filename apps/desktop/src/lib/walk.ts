/** Where a key press moves a cursor down a list of rows.
 *
 *  The arrows, Home and End mean one thing wherever the app draws a list, so
 *  they are worked out in one place: the app menu walks by this and so does the
 *  file list. Null for a key this knows nothing about, which is the caller's
 *  signal to leave the press alone.
 *
 *  `at` is null where nothing is under the cursor yet - a menu somebody opened
 *  with the mouse - and then the first press lands at the end the key came from.
 *  `wrap` is whether the two ends meet: a menu wraps, because that is how a hand
 *  reaches the last row of a long one, and a list of files does not, because
 *  falling off the bottom of a folder into its top would lose somebody's place. */
export function walked(key: string, at: number | null, count: number, wrap = false): number | null {
  if (count <= 0) return null

  switch (key) {
    case 'ArrowDown':
      if (at === null) return 0
      return at + 1 < count ? at + 1 : wrap ? 0 : at
    case 'ArrowUp':
      if (at === null) return count - 1
      return at > 0 ? at - 1 : wrap ? count - 1 : at
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
