import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { CompletionContext } from './index'

describe('what the markdown language gets instead of the completion library', () => {
  test('carries the three things a context is made of', () => {
    const state = EditorState.create({ doc: 'a tag: <div' })
    const context = new CompletionContext(state, 11, true)

    expect(context.state).toBe(state)
    expect(context.pos).toBe(11)
    expect(context.explicit).toBe(true)
  })
})
