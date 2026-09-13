import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { CompletionContext } from './index'

/** What this package is for is a byte count, and the byte count is held to in
 *  apps/desktop/test/weight.test.ts: that the completion library is not in the first
 *  paint, that the root manifest still substitutes this for it, and that this imports
 *  the library nowhere - a wrapper would undo the whole point. What is left to hold
 *  here is the one thing that makes the substitution safe: a context carries what a
 *  context is made of. */
describe('what the markdown language gets instead of the completion library', () => {
  test('carries the three things a context is made of', () => {
    const state = EditorState.create({ doc: 'a tag: <div' })
    const context = new CompletionContext(state, 11, true)

    expect(context.state).toBe(state)
    expect(context.pos).toBe(11)
    expect(context.explicit).toBe(true)
  })
})
