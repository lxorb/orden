/** A Bear export.
 *
 *  Bear writes markdown, so almost nothing has to happen: its files, its folders
 *  and its TextBundles are read the way any folder of notes is. The one thing
 *  that is Bear's own is how it writes a tag with a space in it - `#two words#`,
 *  closed with a second hash - which nothing else reads as a tag at all.
 *
 *  Those become nib's tags, which have no spaces in them: `#two-words`. A tag is
 *  a thing you click, and a space in one is why Bear had to invent the closing
 *  hash in the first place.
 *
 *  Not touched: a hash inside a fence, because `#include` is not a tag and a note
 *  about C is allowed to say `C#`. */

import { readPlain } from './plain'
import type { ImportPlan } from './plan'
import type { Source } from './sources'
import { tagName } from './meta'

/** A tag that closes itself: a hash, something that is not a hash or a newline,
 *  and a hash. At the start of a line or after a space, so `a#b#c` is a word. */
const CLOSED_TAG = /(^|[\s(])#([^#\n]{1,60})#/g

export function readBear(sources: readonly Source[]): Promise<ImportPlan> {
  return readPlain(sources, { format: 'bear', words: bearTags })
}

/** Bear's closed tags as nib's, leaving every fenced block exactly as written. */
export function bearTags(text: string): string {
  let fenced = false

  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return line
      }

      if (fenced) return line

      return line.replace(CLOSED_TAG, (whole, before: string, inside: string) => {
        const name = tagName(inside)
        // A pair of hashes around something that is not a name is words.
        return name ? `${before}#${name}` : whole
      })
    })
    .join('\n')
}
