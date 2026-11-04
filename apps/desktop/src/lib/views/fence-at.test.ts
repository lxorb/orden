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

describe('which fence a view was drawn from', () => {
  const quoted = '> ```base\n> views:\n>   - type: table\n> ```\n'
  const margin = `\`\`\`base\n${code}\`\`\`\n`
  const sample = `\`\`\`\`md\n${margin}\`\`\`\`\n`

  test('a blank line before the closing fence is the same words', () => {
    const note = `\`\`\`base\n${code}\n\n\`\`\`\n`
    const at = fenceAt(note, code)
    expect(at && note.slice(at.from, at.to)).toBe(`${code}\n\n`)
    expect(fenceAt(`\`\`\`base\n${code}\`\`\`\n`, `${code}\n`)).not.toBeNull()
  })

  test('another drawn fence with the same words leaves it unsaid, in a container too', () => {
    expect(fenceAt(`${quoted}\n${margin}`, code)).toBeNull()
    expect(fenceAt(`${margin}\n${quoted}`, code)).toBeNull()
  })

  test('a sample in a code block is not a fence', () => {
    const real = `${sample}\n${margin}`
    const at = fenceAt(real, code)
    expect(at?.from).toBe(real.lastIndexOf(code))
    expect(fenceAt(sample, code)).toBeNull()
    expect(fenceAt(`${sample}\n${quoted}`, code)).toBeNull()
  })

  test('a fence nothing closes is one, and a front matter value is not', () => {
    const open = `\`\`\`base\n${code}`
    const at = fenceAt(open, code)
    expect(at && open.slice(at.from, at.to)).toBe(code)
    const hidden = `---\nnote: \`\`\`base\n---\n${margin}`
    expect(fenceAt(hidden, code)).not.toBeNull()
  })
})
