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

export const knownWords = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values[0] ?? [],
})

const MOST_WORDS = 2000

export const LONGEST_WORD = 64

export function isSpellWord(word: string): boolean {
  return (
    word.length > 0 && word.length <= LONGEST_WORD && /^[\p{L}\p{N}][\p{L}\p{N}'’_-]*$/u.test(word)
  )
}

const pattern = once((joined: string): RegExp | null => {
  const words = joined.split('\n').filter(isSpellWord).slice(0, MOST_WORDS)
  if (!words.length) return null

  const escaped = words.map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
})

const known = Decoration.mark({ attributes: { spellcheck: 'false' }, class: 'orden-known-word' })

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
