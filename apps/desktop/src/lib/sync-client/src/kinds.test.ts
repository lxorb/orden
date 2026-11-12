import { describe, expect, test } from 'vitest'
import { writeShortcut } from '@orden/scan/shortcut'
import { TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { MINE } from './docs'
import { joinsAs, judge, readable, turn } from './kinds'

describe('a web note changed on two devices', () => {
  const when = new Date('2026-10-01T10:00:00Z')
  const base = writeShortcut(
    'https://docs.example.com/a',
    'Docs',
    when,
    'https://docs.example.com/',
  )
  const here = writeShortcut(
    'https://docs.example.com/b',
    'Docs B',
    when,
    'https://docs.example.com/',
  )
  const there = writeShortcut(
    'https://docs.example.com/c',
    'Docs C',
    when,
    'https://docs.example.com/',
  )

  test('the newer copy stands and nothing is lost to a version', () => {
    const newerThere = judge('link', base, here, there, { local: 1, remote: 2 })
    expect(newerThere.verdict).toBe('minor')
    expect(newerThere.resolution).toContain('docs.example.com/c')
    expect(newerThere.lost).toEqual({ local: false, remote: false })

    const newerHere = judge('link', base, here, there, { local: 3, remote: 2 })
    expect(newerHere.resolution).toContain('docs.example.com/b')
  })

  test('one side unchanged is the other side, asked nothing', () => {
    expect(judge('link', base, base, there, { local: 1, remote: 2 })).toMatchObject({
      verdict: 'clean',
      resolution: there,
    })
  })
})

describe('a note seeded with Windows line ends', () => {
  function seeded(words: string): Y.Doc {
    const doc = new Y.Doc()
    doc.getText(TEXT).insert(0, words)
    return doc
  }

  test('takes another program’s edit, rather than refusing every one after', () => {
    const held = '# Plan\r\n\r\nline one\r\n'
    const doc = seeded(held)
    turn('words', doc, held, '# Plan\r\n\r\nline one\r\n\r\nadded offline\r\n', MINE)
    expect(doc.getText(TEXT).toJSON()).toBe('# Plan\n\nline one\n\nadded offline\n')
  })

  test('and an edit worked out against its words with Unix line ends', () => {
    const doc = seeded('# Plan\r\n\r\nline one\r\n')
    turn('words', doc, '# Plan\n\nline one\n', '# Plan\n\nline one\nline two\n', MINE)
    expect(doc.getText(TEXT).toJSON()).toBe('# Plan\n\nline one\nline two\n')
  })
})

describe('an open tab joining its document', () => {
  test('joins where the tab and the entry agree', () => {
    expect(joinsAs('note', 'note')).toBe('views')
    expect(joinsAs('canvas', 'canvas')).toBe('surface')
    expect(joinsAs('pages', 'pages')).toBe('surface')
    expect(joinsAs('canvas', 'pages')).toBe('surface')
  })

  test('joins neither way where a rename made the two disagree', () => {
    expect(joinsAs('canvas', 'note')).toBeNull()
    expect(joinsAs('note', 'canvas')).toBeNull()
  })
})

describe('what a plane reads', () => {
  test('is a canvas, and not any JSON object', () => {
    expect(readable('plane', '{"nodes":[],"edges":[]}')).toBe(true)
    expect(readable('plane', '{"nodes":[]}')).toBe(true)
    expect(readable('plane', '{"title":"x"}')).toBe(false)
    expect(readable('plane', '{"nodes":{}}')).toBe(false)
    expect(readable('plane', 'prose')).toBe(false)
    expect(readable('plane', '')).toBe(false)
    expect(readable('words', '{"title":"x"}')).toBe(true)
  })
})
