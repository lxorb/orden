import { describe, expect, test } from 'vitest'
import { fenceAt } from './source'

const code = 'views:\n  - type: table\n'

describe('the fence a base came from, found again', () => {
  test('is the one holding these words, however it is closed', () => {
    const note = `a\n\n\`\`\`base\n${code}\`\`\`\n\nb\n`
    const at = fenceAt(note, code)
    expect(at && note.slice(at.from, at.to)).toBe(code)
    expect(fenceAt(`~~~~base\n${code}~~~~\n`, code)).not.toBeNull()
    expect(fenceAt(`\`\`\`base\r\n${code.replaceAll('\n', '\r\n')}\`\`\`\r\n`, code)).not.toBeNull()
    expect(fenceAt(`\`\`\`base\n${code}\`\`\``, code.trimEnd())).not.toBeNull()
    // Another fence's words are no bar to it.
    expect(
      fenceAt(`\`\`\`base\nother: 1\n\`\`\`\n\`\`\`base\n${code}\`\`\`\n`, code),
    ).not.toBeNull()
  })

  test('is nothing where it cannot be written into, or two say the same', () => {
    const quoted = `> \`\`\`base\n> views:\n>   - type: table\n> \`\`\`\n`
    expect(fenceAt(quoted, code)).toBeNull()
    expect(fenceAt(`- \`\`\`base\n  views:\n    - type: table\n  \`\`\`\n`, code)).toBeNull()
    const twice = `\`\`\`base\n${code}\`\`\`\n\n\`\`\`base\n${code}\`\`\`\n`
    expect(fenceAt(twice, code)).toBeNull()
    expect(fenceAt('no fence', code)).toBeNull()
  })
})
