import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'

const setTrusted = StateEffect.define<boolean>()

const trustedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTrusted)) return effect.value
    }
    return value
  },
})

export function trustsMarkup(state: EditorState): boolean {
  return state.field(trustedField, false) ?? false
}

export function trustedMarkup(trusted: boolean | undefined): Extension {
  return trustedField.init(() => trusted ?? false)
}

export function trustedMarkupEffect(trusted: boolean): StateEffect<unknown> {
  return setTrusted.of(trusted)
}

export function trustChanged(before: EditorState, after: EditorState): boolean {
  return before.field(trustedField, false) !== after.field(trustedField, false)
}
