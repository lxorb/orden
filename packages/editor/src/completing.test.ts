import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { expect, test } from 'vitest'
import { completing } from './completing'

test('the popup leaves Ctrl+Space to the app and keeps its own keys', () => {
  for (const pairs of [false, true]) {
    const bound = EditorState.create({ extensions: completing(pairs) })
      .facet(keymap)
      .flat()

    expect(bound.some((binding) => binding.key === 'Ctrl-Space')).toBe(false)
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Enter']) {
      expect(
        bound.some((binding) => binding.key === key),
        key,
      ).toBe(true)
    }
  }
})
