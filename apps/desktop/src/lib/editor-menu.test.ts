import { describe, expect, test } from 'vitest'
import { blockLinkName } from './editor-menu'

/** The block menu's Copy link names the block first, which is a change to the file:
 *  ` ^id` at the end of the block's last line. Only a note has blocks to name; in a
 *  stylesheet, a snippet list or a text file the name is a line spoiled. */

describe('the note a block link points into', () => {
  test('is the note the block is in', () => {
    expect(blockLinkName('/space/Plan.md')).toBe('Plan')
  })

  test('is none for a file that is not a note', () => {
    for (const path of ['/space/custom.css', '/space/snippets.json', '/space/a.txt']) {
      expect(blockLinkName(path)).toBeNull()
    }
  })

  test('is none for a note nobody has saved', () => {
    expect(blockLinkName(null)).toBeNull()
  })
})
