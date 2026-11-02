import { describe, expect, test } from 'vitest'
import { reformat } from './reformat'

describe('tidying a document', () => {
  test('settles on one bullet character', () => {
    expect(reformat('* one\n* two\n')).toBe('- one\n- two\n')
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

describe('code and blocks the parser keeps, wherever they sit', () => {
  test('leaves code in a quote or a callout as written', () => {
    const source = '> [!note]\n> ```py\n> x = __name__ + 1\n> * star\n> ```\n'
    expect(reformat(source)).toBe(source)
  })

  test('leaves code in a nested list item as written, blank lines and all', () => {
    const source =
      '- a\n  - b\n\n    ```py\n    * star\n    y = _x_ or __dunder__ \n\n\n    z\n    ```\n'
    expect(reformat(source)).toBe(source)
  })

  test('a pipe table in indented code stays code', () => {
    const source = 'Text\n\n    | a | b |\n    |-|-|\n'
    expect(reformat(source)).toBe(source)
  })

  test('a pipe table in a comment, maths or an HTML block stays as written', () => {
    for (const source of [
      '<!--\n|a|b|\n|-|-|\n-->\n',
      '$$\n|a|b|\n|-|-|\n$$\n',
      '<div>\n|a|b|\n|-|-|\n</div>\n',
    ]) {
      expect(reformat(source)).toBe(source)
    }
  })

  test('a table in a list item keeps its indent, so it stays in the item', () => {
    const source = '- x\n\n  |a|b|\n  |-|-|\n'
    expect(reformat(source)).toBe(source)
  })

  test('a table in prose is still re-aligned, inline code in its cells and all', () => {
    expect(reformat('|a|`b`|\n|-|-|\n')).toBe('| a   | `b` |\n| --- | --- |\n')
  })
})

describe('what Format document must not touch', () => {
  test.each([
    '[[a _b_ c]]\n',
    '![[a _b_ c]]\n',
    '[[_a_|shown]]\n',
    '[x](_f_.md)\n',
    '[x](__f__.md)\n',
    '[x](a.md "_t_")\n',
    '![x](_p_.png)\n',
    '[x][_ref_]\n',
    '[ref]: _u_\n',
    '[ref]: u "_t_"\n',
    '<http://x/_a_>\n',
  ])('the target of %j', (source) => {
    expect(reformat(source)).toBe(source)
  })

  test('words around a link and a link label are still tidied', () => {
    expect(reformat('_a_ [[b]] _c_\n')).toBe('*a* [[b]] *c*\n')
    expect(reformat('[ _x_ ](a.md)\n')).toBe('[ *x* ](a.md)\n')
  })

  test.each([
    '---\nPriorität: _hoch_\nlist:\n  * a\n---\n',
    '---\ndue date: a_b_ _c_\nx: * y\n---\n',
    '---\nSize (cm): _3_\n---\n',
    '---\n日期: _x_\n---\n',
    '---\n# a comment\nk: _v_\n---\n',
    '---\n"k": _v_\n---\n',
    '\uFEFF---\nk: _v_\n---\n',
  ])('front matter %j, whatever its first key is', (source) => {
    expect(reformat(source)).toBe(source)
  })

  test('a line of hyphens with nothing to close it is a rule and what follows is words', () => {
    expect(reformat('---\n\n_a_\n')).toBe('---\n\n*a*\n')
  })
})

describe('bullets that mean something', () => {
  test('a plus stays a plus: a deck reads it as a click', () => {
    expect(reformat('+ x\n+ y\n')).toBe('+ x\n+ y\n')
  })

  test('two lists side by side stay two lists', () => {
    expect(reformat('- a\n* b\n')).toBe('- a\n* b\n')
    expect(reformat('* a\n- b\n')).toBe('* a\n- b\n')
    expect(reformat('* a\n\n- b\n')).toBe('* a\n\n- b\n')
    expect(reformat('- a\n  * b\n  + c\n')).toBe('- a\n  * b\n  + c\n')
  })

  test('a star list on its own still becomes dashes', () => {
    expect(reformat('* a\n* b\n\nwords\n\n* c\n')).toBe('- a\n- b\n\nwords\n\n- c\n')
  })
})
