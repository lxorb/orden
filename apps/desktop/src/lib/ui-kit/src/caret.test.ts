import { expect, test } from 'vitest'
import { type Claims, type Showing, takesCaret } from './caret'

const NOTE: Showing = { kind: 'note', reading: false }
const CLEAR: Claims = { overlaid: false, renaming: false, touch: false }

test.each([
  [NOTE, CLEAR, true],
  [null, CLEAR, false],
  [{ kind: 'canvas', reading: false }, CLEAR, false],
  [{ kind: 'pdf', reading: false }, CLEAR, false],
  [{ kind: 'graph', reading: false }, CLEAR, false],
  [{ kind: 'note', reading: true }, CLEAR, false],
  [NOTE, { ...CLEAR, overlaid: true }, false],
  [NOTE, { ...CLEAR, renaming: true }, false],
  [NOTE, { ...CLEAR, touch: true }, false],
] as [Showing | null, Claims, boolean][])(
  'the caret goes into %o under %o only for a note being written, with nothing over it, off a finger’s screen: %s',
  (showing, claims, takes) => {
    expect(takesCaret(showing, claims)).toBe(takes)
  },
)
