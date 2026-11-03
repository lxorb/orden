/** A tool row's verb and object. */

import { describe, expect, test } from 'vitest'
import { bareName, helperOf, objectOf, verbOf } from './verbs'

describe('a tool row', () => {
  test('says nib’s tools with a verb, whichever road called them', () => {
    expect(verbOf('read_note')).toBe('Read')
    expect(verbOf('mcp__nib__edit_note')).toBe('Edited')
    expect(verbOf('browser_click')).toBe('Clicked')
    expect(bareName('mcp__nib__create_note')).toBe('create_note')
  })

  test('leaves a tool it does not know to its own name', () => {
    expect(verbOf('something_new')).toBeNull()
  })

  test('names a note without its folder or extension, a page by its host, a search by its words', () => {
    expect(objectOf({ path: 'Reading/Birds/Herons.md' })).toBe('Herons')
    expect(objectOf({ url: 'https://example.org/a/b' })).toBe('example.org')
    expect(objectOf({ query: 'kestrel' })).toBe('“kestrel”')
    expect(objectOf(null)).toBe('')
  })
})

describe('a helper’s row (#1062)', () => {
  test('names the helper’s thread it opens, from the API loop or a session’s answer', () => {
    const ok = (text: string, agent?: string) => ({
      text,
      images: [],
      error: false,
      ...(agent ? { agent } : {}),
    })
    expect(helperOf({ verb: 'run_agent', result: ok('Two herons.', 'h-1') })).toBe('h-1')
    expect(
      helperOf({ verb: 'mcp__nib__run_agent', result: ok('{"agent": "h-2", "state": "done"}') }),
    ).toBe('h-2')
    expect(helperOf({ verb: 'agent_result', result: ok('{"agent":"h-3"}') })).toBe('h-3')
    expect(helperOf({ verb: 'read_note', result: ok('{"agent":"h-4"}') })).toBeNull()
    expect(helperOf({ verb: 'run_agent' })).toBeNull()
  })
})
