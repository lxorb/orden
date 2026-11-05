import { afterEach, describe, expect, test } from 'vitest'
import { unsynced } from './unsynced.svelte'

describe('the line that says a file is not syncing', () => {
  afterEach(() => unsynced.dismiss())

  test('names one file', () => {
    unsynced.show('a.md')
    unsynced.show('a.md')
    expect(unsynced.said).toBe('a.md')
    expect(unsynced.many).toBe(1)
  })

  test('says how many when there are several, and starts over once dismissed', () => {
    unsynced.show('a.md')
    unsynced.show('b.png')
    expect(unsynced.many).toBe(2)
    unsynced.dismiss()
    expect(unsynced.said).toBeNull()
    unsynced.show('c.md')
    expect(unsynced.many).toBe(1)
  })
})
