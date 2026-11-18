import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'

const setTrusted = StateEffect.define<boolean>()

const trustedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setTrusted)) return effect.value
    return value
  },
})

export const trustsMarkup = (state: EditorState): boolean =>
  state.field(trustedField, false) ?? false

export const trustedMarkup = (trusted: boolean | undefined): Extension =>
  trustedField.init(() => trusted ?? false)

export const trustedMarkupEffect = (trusted: boolean): StateEffect<unknown> =>
  setTrusted.of(trusted)

export const trustChanged = (before: EditorState, after: EditorState): boolean =>
  before.field(trustedField, false) !== after.field(trustedField, false)
