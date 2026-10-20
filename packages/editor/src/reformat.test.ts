import { describe, expect, test } from 'vitest'
import { reformat } from './reformat'

describe('tidying a document', () => {
  test('settles on one bullet character', () => {
    expect(reformat('* one\n+ two\n- three\n')).toBe('- one\n- two\n- three\n')
  })

  test('keeps nesting intact', () => {
    expect(reformat('* one\n  * nested\n')).toBe('- one\n  - nested\n')
  })

  test('settles on one emphasis style', () => {
    expect(reformat('_italic_ and __bold__\n')).toBe('*italic* and **bold**\n')
  })

  test('leaves an underscore inside a word alone', () => {
    expect(reformat('snake_case_name stays\n')).toBe('snake_case_name stays\n')
  })

  test('drops trailing hashes from a heading', () => {
    expect(reformat('## Title ##\n')).toBe('## Title\n')
  })

  test('collapses runs of blank lines', () => {
    expect(reformat('a\n\n\n\nb\n')).toBe('a\n\nb\n')
  })

  test('strips trailing spaces', () => {
    expect(reformat('text   \n')).toBe('text\n')
  })

  test('ends with exactly one newline', () => {
    expect(reformat('text\n\n\n')).toBe('text\n')
    expect(reformat('text')).toBe('text\n')
  })

  test('re-aligns a table', () => {
    expect(reformat('|a|bb|\n|-|-|\n|cccc|d|\n')).toBe(
      ['| a    | bb  |', '| ---- | --- |', '| cccc | d   |', ''].join('\n'),
    )
  })

  test('leaves code fences exactly as written', () => {
    const source = '```js\nconst  x   =  1\n*  not a list\n```\n'
    expect(reformat(source)).toBe(source)
  })

  test('a tilde run inside a backtick block does not end it', () => {
    const source = '```md\n~~~\n*  still code\n~~~\n```\n\n* a list\n'
    expect(reformat(source)).toBe('```md\n~~~\n*  still code\n~~~\n```\n\n- a list\n')
  })

  test('a fence nothing closes takes the rest of the note with it', () => {
    const source = '```\n*  still code\n_still code_\n'
    expect(reformat(source)).toBe(source)
  })

  test('leaves front matter exactly as written', () => {
    const source = '---\ntitle: _Notes_ on * things\ntags: [a, b]\n---\n\n* a list\n'
    expect(reformat(source)).toBe(
      '---\ntitle: _Notes_ on * things\ntags: [a, b]\n---\n\n- a list\n',
    )
  })

  test('a leading rule is not front matter', () => {
    expect(reformat('---\n\n_text_\n')).toBe('---\n\n*text*\n')
  })

  test('leaves a document that is already tidy unchanged', () => {
    const source = '# Title\n\n- one\n- two\n\n*emphasis* here\n'
    expect(reformat(source)).toBe(source)
  })

  test('does not disturb prose containing a pipe', () => {
    expect(reformat('a | b is not a table\n')).toBe('a | b is not a table\n')
  })

  test('a thematic break stays a rule', () => {
    expect(reformat('* * *\n')).toBe('* * *\n')
  })

  test('keeps the spaces of a hard line break', () => {
    expect(reformat('line one  \nline two\n')).toBe('line one  \nline two\n')
  })

  test('leaves inline code as written and tidies around it', () => {
    expect(reformat('`x = _a_ + 1`\n')).toBe('`x = _a_ + 1`\n')
    expect(reformat('* _a_ `_b_` _c_\n')).toBe('- *a* `_b_` *c*\n')
  })

  test('leaves indented code as written', () => {
    const source = 'text\n\n    * not a list\n\n\n    _still code_\n'
    expect(reformat(source)).toBe(source)
  })

  test('leaves maths as written', () => {
    expect(reformat('$$\n_a_ + __b__\n$$\n')).toBe('$$\n_a_ + __b__\n$$\n')
    expect(reformat('_a_ and $_b_$\n')).toBe('*a* and $_b_$\n')
  })

  test('leaves an HTML comment as written', () => {
    const source = '<!--\n* keep\n\n\n_x_\n-->\n'
    expect(reformat(source)).toBe(source)
  })
})
