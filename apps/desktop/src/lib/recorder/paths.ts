/** Where a file written beside a note sits, as the space speaks of paths.
 *
 *  One piece of arithmetic, on its own because it is pure and because getting it wrong
 *  is invisible: a path a segment out means an embed that resolves to nothing and a
 *  player that draws nothing, with no error anywhere.
 *
 *  See note.ts, which is the only caller, and link-index.svelte.ts, which is what the
 *  answer is handed to. */

import { folderOf, relativeTo } from '../space-paths'

/** `save_asset` answers with a path relative to the *note's own folder* - `assets/x`
 *  for a note at the top of the space, `../assets/x` for one a folder down - and the
 *  link index speaks in paths relative to the space's root. This is the arithmetic
 *  between the two, `..` and all, and it is pure so it can be tested rather than
 *  reasoned about.
 *
 *  Null for a path that climbs out of the space, which the command that wrote it
 *  refuses anyway; answering null rather than a path outside the root keeps this from
 *  being the one place that disagrees. */
export function spaceRelative(root: string, notePath: string, written: string): string | null {
  const folder = relativeTo(root, folderOf(notePath))
  // A note outside the space: `relativeTo` hands back the path it was given, which is
  // absolute and is nothing this can make a space-relative path out of.
  if (folder.startsWith('/') || /^[a-z]:/i.test(folder)) return null

  const parts = folder ? folder.split('/') : []

  for (const step of written.split('/')) {
    if (!step || step === '.') continue
    if (step === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }

    parts.push(step)
  }

  return parts.join('/')
}
