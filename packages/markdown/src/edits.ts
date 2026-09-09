/** One edit, and the smallest one two versions of a text differ by.
 *
 *  Here rather than in either caller because two of them want the same answer for
 *  the same reason. A note's front matter and a canvas's `nib` key are both metadata
 *  somebody's file carries, and setting one has to come out as an edit of the
 *  characters that moved rather than as a rewritten file: a note open in a pane takes
 *  the edit and keeps every caret in it where its reader left it, and the version
 *  kept before the write is a version of the file rather than of the app's idea of
 *  it. See front-matter.ts and canvas.ts. */

/** A replacement of one span of a text. The offsets are into the text before it. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** The single span two texts differ over: everything they share at the front and at
 *  the back taken off. Null where they do not differ at all, which is a caller that
 *  should write no file.
 *
 *  One span and not a diff. Setting a key changes one run of characters in one place
 *  even when it takes two passes to work out what that run is, and a caller that
 *  wanted several spans would want a diff library rather than this. */
export function oneEdit(before: string, after: string): TextEdit | null {
  if (before === after) return null

  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++

  let back = 0
  while (
    back < before.length - from &&
    back < after.length - from &&
    before[before.length - 1 - back] === after[after.length - 1 - back]
  ) {
    back++
  }

  return { from, to: before.length - back, insert: after.slice(from, after.length - back) }
}
