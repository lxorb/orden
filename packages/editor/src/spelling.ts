/** The words the reader has said are words.
 *
 *  nib does not spell-check: the webview does, and it draws the wavy line itself,
 *  outside the document. No browser gives a page a way to ask which words it
 *  thinks are wrong, to read its suggestions, or to add one to its dictionary -
 *  deliberately, and on every platform. So "add to dictionary" cannot mean what
 *  it means in a native app.
 *
 *  What a page *can* do is say which text not to check. `spellcheck="false"` on an
 *  element inside the writing surface turns the checker off for that element, and
 *  a mark decoration is an element. So a word the reader has added is drawn with
 *  the checker turned off over it, and the wavy line under it goes - which is the
 *  whole of what adding a word to a dictionary is for.
 *
 *  It is honest about what it is not: the word is not learned by the system, so
 *  another app still underlines it, and nothing here can offer a suggestion for a
 *  word that really is misspelled. It is one mechanism on all three platforms
 *  rather than three that disagree, it needs no dictionary shipped and no words
 *  sent anywhere, and the list is the reader's own to read.
 *
 *  Only the lines on screen are scanned, so a note of any length costs the same. */

import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { Facet } from '@codemirror/state'
import { once } from './once'

/** The words, lowercased, as a facet so a view can be told a new list without
 *  being rebuilt. */
export const knownWords = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values[0] ?? [],
})

/** Well past any reader's list, and a ceiling so the pattern built from it stays
 *  something a regular expression engine will take. */
const MOST_WORDS = 2000

/** The longest a word may be. A phrase is not a word, and a dictionary of
 *  sentences is a dictionary that turns the checker off. */
export const LONGEST_WORD = 64

/** Whether something is a word this can hold: letters, digits and the marks that
 *  sit inside a word, and nothing that would mean something to a pattern. */
export function isSpellWord(word: string): boolean {
  return (
    word.length > 0 && word.length <= LONGEST_WORD && /^[\p{L}\p{N}][\p{L}\p{N}'’_-]*$/u.test(word)
  )
}

/** The words as one pattern, or null for an empty list. Built once per list, so
 *  a redraw costs nothing.
 *
 *  Bounded on each side by "not a word character", rather than `\b`, so an
 *  apostrophe or an accent inside a word counts as part of it. */
const pattern = once((joined: string): RegExp | null => {
  const words = joined.split('\n').filter(isSpellWord).slice(0, MOST_WORDS)
  if (!words.length) return null

  const escaped = words.map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
})

/** The checker turned off over one word. */
const known = Decoration.mark({ attributes: { spellcheck: 'false' }, class: 'nib-known-word' })

/** Where each of `words` stands in `text`, in order. The arithmetic on its own,
 *  so what a note is quietened over can be tested without a document. */
export function knownRanges(
  text: string,
  words: readonly string[],
): { from: number; to: number }[] {
  if (!words.length) return []

  const found = pattern(words.join('\n'))
  if (!found) return []

  const out: { from: number; to: number }[] = []
  found.lastIndex = 0

  for (let hit = found.exec(text); hit; hit = found.exec(text)) {
    out.push({ from: hit.index, to: hit.index + hit[0].length })
    // A word of nothing would never advance, and the loop would not end.
    if (hit[0].length === 0) found.lastIndex++
  }

  return out
}

function marks(view: EditorView): DecorationSet {
  const words = view.state.facet(knownWords)
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    for (const range of knownRanges(view.state.doc.sliceString(from, to), words)) {
      builder.add(from + range.from, from + range.to, known)
    }
  }

  return builder.finish()
}

export function spellingWords() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = marks(view)
      }

      update(update: ViewUpdate) {
        // The list itself changing is a reconfiguration, which shows up here as
        // a changed facet rather than as a document change.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.startState.facet(knownWords) !== update.state.facet(knownWords)
        ) {
          this.decorations = marks(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
