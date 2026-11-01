import { readTask } from '@orden/markdown/task-line'
import { describe, expect, test } from 'vitest'
import { pieces, plain } from './inline'

/** A task's words as a view draws them: its own markup as itself, and a character the
 *  note had to escape as the character, never with its backslash. */
describe('a task line drawn in a view', () => {
  test('shows an escaped character as the character', () => {
    const task = readTask('- [ ] Prices \\$5-\\$10 \\~5 min a=\\=b milk \\$3')
    expect(plain(task?.text ?? '')).toBe('Prices $5-$10 ~5 min a==b milk $3')
  })

  test('opens no markup on an escaped marker, and keeps its own markup', () => {
    expect(pieces('\\*not em\\* and **bold** [page](https://x.test/a) `a\\$b`')).toEqual([
      { text: '*not em* and ' },
      { text: 'bold', strong: true },
      { text: ' ' },
      { text: 'page', link: 'https://x.test/a' },
      { text: ' ' },
      { text: 'a\\$b', code: true },
    ])
  })

  test('a backslash at the end of code is code, not an escaped backtick', () => {
    expect(pieces('open `C:\\` now')).toEqual([
      { text: 'open ' },
      { text: 'C:\\', code: true },
      { text: ' now' },
    ])
  })
})
