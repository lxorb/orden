import { type EditorState, type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import type { Cover } from '@orden/markdown/cover'

const setKeptCover = StateEffect.define<Cover | null>()
const keptCoverField = StateField.define<Cover | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setKeptCover)) return effect.value
    return value
  },
})
export const coverMover = Facet.define<(position: number) => void, ((position: number) => void) | null>({
  combine: (values) => values.at(-1) ?? null,
})
export const keptCover = (state: EditorState): Cover | null => state.field(keptCoverField, false) ?? null
export function keptCoverChanged(before: EditorState, after: EditorState): boolean {
  const one = keptCover(before)
  const other = keptCover(after)
  return one?.src !== other?.src || one?.position !== other?.position
}
export const keptCoverExtension = (cover: Cover | null | undefined): Extension =>
  keptCoverField.init(() => cover ?? null)
export const keptCoverEffect = (cover: Cover | null): StateEffect<unknown> => setKeptCover.of(cover)
