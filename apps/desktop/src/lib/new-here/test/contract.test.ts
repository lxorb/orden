import { describe, expect, test } from 'vitest'
import { kindLines, newKinds } from '../src/api'

describe('the kinds a new tab can be', () => {
  test('are offered from the kinds here, each once, in its line', () => {
    const kinds = newKinds()
    expect(kinds.map((one) => one.kind)).toEqual([...new Set(kinds.map((one) => one.kind))])
    expect(kindLines(kinds).flat()).toHaveLength(kinds.length)
  })
})
