import { describe, expect, test } from 'vitest'
import { CODE, CodeBlocks, closesFence, closingTicks, fenceMark, OPENS, WORDS } from './fences'

describe('the mark a fence line carries', () => {
  test('three or more of either character', () => {
    expect(fenceMark('```')).toBe('```')
    expect(fenceMark('````')).toBe('````')
    expect(fenceMark('~~~')).toBe('~~~')
    expect(fenceMark('~~~~~')).toBe('~~~~~')
  })

  test('with the info string after it, which is not part of the mark', () => {
    expect(fenceMark('```ts some/file.ts')).toBe('```')
  })

  test('indented by up to three spaces', () => {
    expect(fenceMark('   ```')).toBe('```')
    expect(fenceMark('    ```')).toBeNull()
  })

  test('and nothing for a line that is not a fence', () => {
    expect(fenceMark('``')).toBeNull()
    expect(fenceMark('a ``` b')).toBeNull()
    expect(fenceMark('')).toBeNull()
  })
})

describe('what closes a fence', () => {
  test('the same character, at least as many of them', () => {
    expect(closesFence('```', '```')).toBe(true)
    expect(closesFence('````', '```')).toBe(true)
    expect(closesFence('```', '````')).toBe(false)
  })

  test('never the other character', () => {
    expect(closesFence('~~~', '```')).toBe(false)
    expect(closesFence('```', '~~~')).toBe(false)
  })

  test('and never a line carrying an info string', () => {
    expect(closesFence('```ts', '```')).toBe(false)
    expect(closesFence('```  ', '```')).toBe(true)
  })

  test('a line that is not a fence at all closes nothing', () => {
    expect(closesFence('const x = 1', '```')).toBe(false)
  })
})

/** #493: CommonMark 4.5 - a backtick fence's info string holds no backtick. */
describe('a line of inline code in three backticks', () => {
  test('is not a fence, however many backticks', () => {
    expect(fenceMark('```inline```')).toBeNull()
    expect(fenceMark('``` a ` b')).toBeNull()
    expect(fenceMark('````x````')).toBeNull()
    expect(fenceMark('```js `x`')).toBeNull()
  })

  test('while a tilde fence may have backticks after it', () => {
    expect(fenceMark('~~~ `odd` but allowed')).toBe('~~~')
  })

  test('and does not close one either', () => {
    expect(closesFence('``` ```', '```')).toBe(false)
  })
})

describe('the run that closes a code span', () => {
  test('is one of exactly the same length', () => {
    expect(closingTicks('`` a ``` b `` c', 2, 2)).toBe(11)
    expect(closingTicks('` a `` b', 1, 1)).toBe(-1)
    expect(closingTicks('` a `', 1, 1)).toBe(4)
  })
})

/** The twin of these is the tests in code_blocks.rs: the same notes, the same
 *  answers. One letter a line: `w` for words, `c` for code, `o` for a fence that
 *  opens. */
function walk(note: string): string {
  const code = new CodeBlocks()
  const letters = { [WORDS]: 'w', [CODE]: 'c', [OPENS]: 'o' }
  return note
    .split('\n')
    .map((line) => letters[code.line(line)])
    .join('')
}

describe('which lines are code', () => {
  test('a fence at the margin', () => {
    expect(walk('a\n```\n#x\n```\nb')).toBe('woccw')
  })

  test('a fence inside a quote, which ends with the quote', () => {
    expect(walk('> ```css\n> #fff\n> ```\n> b')).toBe('occw')
    expect(walk('> ```\n> #no\n#yes')).toBe('ocw')
  })

  test('a fence inside a list item', () => {
    expect(walk('- item\n\n  ```\n  #no\n  ```\n#yes')).toBe('wwoccw')
  })

  test('indented code, but not an indented line carrying a paragraph on', () => {
    expect(walk('Notes\n\n    #include\n\n#yes')).toBe('wwccw')
    expect(walk('words\n    #yes')).toBe('ww')
    expect(walk('- item\n\n      #define X\n#yes')).toBe('wwcw')
    expect(walk('> words\n>\n>     #no')).toBe('wwc')
  })

  test('a fence closes only on the same mark, at least as long, with nothing after it', () => {
    expect(walk('````\n```\n#x\n```\n````\nb')).toBe('occccw')
    expect(walk('```\n~~~\n```\nb')).toBe('occw')
    expect(walk('```\n``` ts\n```\nb')).toBe('occw')
  })

  test('a fence opens at three spaces of indent but not four', () => {
    expect(walk('   ```\nx\n```\nb')).toBe('occw')
    expect(walk('words\n    ```\nb')).toBe('www')
  })

  test('backticks with a backtick after them open no fence', () => {
    expect(walk('```a`a\n#yes')).toBe('ww')
  })

  test('a tab counts as the columns it stands for', () => {
    expect(walk('\t#include')).toBe('c')
    expect(walk('>\t#include')).toBe('w')
    expect(walk('>\t\t#include')).toBe('c')
  })

  test('a line break written as CRLF', () => {
    expect(walk('```\r\n#x\r\n```\r\nb')).toBe('occw')
  })
})
