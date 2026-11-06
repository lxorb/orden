import { describe, expect, test } from 'vitest'
import { setextEdits, withoutSetext } from './setext'

describe('a note written with underlined headings', () => {
  test.each([
    ['Title\n=====\n\nbody', '# Title\n\nbody'],
    ['Title\n-----\n\nbody', '## Title\n\nbody'],
    ['Title\n-\nbody', '## Title\nbody'],
    ['intro\n\nOne\n===\n\nTwo\n---\n', 'intro\n\n# One\n\n## Two\n'],
    ['first line\nsecond line\n---', '## first line second line'],
    ['> Quoted\n> ---\n> after', '> ## Quoted\n> after'],
    ['- item\n\n  Inside\n  ===\n', '- item\n\n  # Inside\n'],
    ['Ends in a hash #\n===', '# Ends in a hash \\#'],
    ['**Bold** title\n---', '## **Bold** title'],
  ])('%j reads the same with hashes', (before, after) => {
    expect(withoutSetext(before)).toBe(after)
  })

  test.each([
    '# Already\n\nbody',
    'text\n\n---\n\nmore',
    '---\ntitle: front matter\n---\n\nbody',
    '```\ncode\n---\n```',
    '    indented\n    ---',
    '| a | b |\n| --- | --- |\n| c | d |',
    'text\n- item',
    '',
  ])('%j is left alone', (text) => {
    expect(setextEdits(text)).toEqual([])
  })
})
