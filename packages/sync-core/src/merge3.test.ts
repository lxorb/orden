import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { changes, edited, note } from '../test/markdown'
import { merge3, mergedOn } from './merge3'

describe('merge3', () => {
  test('one side untouched is the other side', () => {
    const merged = merge3('The cat sat.', 'The dog sat.', 'The cat sat.')
    expect(merged.text).toBe('The dog sat.')
    expect(merged.meetings).toEqual([])
  })

  test('edits in different places are both kept', () => {
    const merged = merge3(
      'The cat sat on the mat.',
      'The dog sat on the mat.',
      'The cat sat on the rug.',
    )
    expect(merged.text).toBe('The dog sat on the rug.')
    expect(merged.meetings).toEqual([])
  })

  test('the same edit on both sides counts once', () => {
    const merged = merge3('I saw teh cat.', 'I saw the cat.', 'I saw the cat.')
    expect(merged.identical.length).toBeGreaterThan(0)
    expect(merged.meetings).toEqual([])
    expect(merged.text).toBe('I saw the cat.')
  })

  test('insertions at one point are both kept, local first', () => {
    const merged = merge3('- a\n', '- a\n- b\n', '- a\n- c\n')
    expect(merged.meetings).toEqual([])
    expect(merged.text).toBe('- a\n- b\n- c\n')
  })

  test('an insertion beside a replacement is beside it, not in it', () => {
    const merged = merge3('Hello world', 'Hello there', 'Hello world!')
    expect(merged.meetings).toEqual([])
    expect(merged.text).toBe('Hello there!')
  })

  test('replacements that overlap meet, and are settled as asked', () => {
    const base = 'I will see the big cat today.'
    const local = 'I will see the small dog today.'
    const remote = 'I will see the big lion today.'

    const [meeting] = merge3(base, local, remote).meetings
    expect(meeting?.base.from).toBeLessThanOrEqual(base.indexOf('big'))
    expect(meeting?.local.length).toBeGreaterThan(0)
    expect(meeting?.remote.length).toBeGreaterThan(0)

    expect(merge3(base, local, remote, () => 'local').text).toBe(local)
    expect(merge3(base, local, remote, () => 'remote').text).toBe(remote)
  })

  test('one passage put back at one point by both sides meets, rather than being said twice', () => {
    const base = 'Intro.\n\nOutro.\n'
    const passage = 'We ship on Monday after the review, with milk and eggs.\n\n'
    const local = `Intro.\n\n${passage}Outro.\n`
    const remote = `Intro.\n\n${passage.replace('Monday', 'Tuesday')}Outro.\n`

    const merged = merge3(base, local, remote, () => 'remote')
    expect(merged.meetings).toHaveLength(1)
    expect(merged.text).toBe(remote)
  })

  test('two different lines appended at one point are both kept', () => {
    const merged = merge3('- milk\n', '- milk\n- eggs and bread\n', '- milk\n- a new kettle\n')
    expect(merged.meetings).toEqual([])
    expect(merged.text).toBe('- milk\n- eggs and bread\n- a new kettle\n')
  })

  test('an insertion strictly inside a span the other replaced meets it', () => {
    const merged = merge3('one two three', 'one tw-o three', 'one 2 three')
    expect(merged.meetings).toHaveLength(1)
  })

  test('a meeting settled both ways loses nothing either side wrote', () => {
    const merged = merge3('the cat sat', 'the dog sat', 'the cow sat')
    for (const word of ['d', 'o', 'g', 'w']) expect(merged.text).toContain(word)
  })

  test('one passage written twice at one point, settled both ways, keeps both', () => {
    // The two lines share more than a line of words, so they meet as one passage
    // written twice - a meeting that covers no ancestor at all, from === to. Both its
    // insertions stand at `to`, the one point a walk over the covered ancestor never
    // reaches, and the default settling must still lose nothing either side wrote.
    const base = 'Intro.\n\nEnd.'
    const line = 'The quick brown fox jumps over the lazy dog today'
    const local = `Intro.\n\n${line}.\nEnd.`
    const remote = `Intro.\n\n${line}, again.\nEnd.`

    const merged = merge3(base, local, remote)
    expect(merged.meetings).toHaveLength(1)
    expect(merged.text).toBe(`Intro.\n\n${line}.\n${line}, again.\nEnd.`)
  })

  test('the size is what both sides wrote plus the ancestor they cover', () => {
    const [meeting] = merge3('a cat b', 'a dog b', 'a cow b').meetings
    const written = [...(meeting?.local ?? []), ...(meeting?.remote ?? [])].reduce(
      (sum, edit) => sum + edit.insert.length,
      0,
    )
    expect(meeting?.size).toBe(written + ((meeting?.base.to ?? 0) - (meeting?.base.from ?? 0)))
  })

  test('never cuts a pair: an emoji changed on one side, a word on the other', () => {
    const merged = merge3('a 😀 b c', 'a 😃 b c', 'a 😀 b d')
    expect(merged.text).toBe('a 😃 b d')
  })

  test('property: merge3(B, L, B) is L', () => {
    fc.assert(
      fc.property(note, changes, (base, mine) => {
        const local = edited(base, mine)
        expect(merge3(base, local, base).text).toBe(local)
        expect(merge3(base, base, local).text).toBe(local)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: disjoint edits both land, whole', () => {
    fc.assert(
      fc.property(note, note, changes, changes, (first, second, mine, theirs) => {
        const separator = '\n\n<!-- apart -->\n\n'
        const base = `${first}${separator}${second}`
        const local = `${edited(first, mine)}${separator}${second}`
        const remote = `${first}${separator}${edited(second, theirs)}`

        const merged = merge3(base, local, remote)
        expect(merged.meetings).toEqual([])
        expect(merged.text).toBe(`${edited(first, mine)}${separator}${edited(second, theirs)}`)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: which side is local changes nothing but the order at a shared point', () => {
    fc.assert(
      fc.property(note, changes, changes, (base, mine, theirs) => {
        const local = edited(base, mine)
        const remote = edited(base, theirs)
        const one = merge3(base, local, remote)
        const other = merge3(base, remote, local)

        expect(one.meetings.length).toBe(other.meetings.length)
        expect(one.meetings.map((meeting) => meeting.size)).toEqual(
          other.meetings.map((meeting) => meeting.size),
        )
        expect(one.text.length).toBe(other.text.length)
      }),
      { numRuns: 1000 },
    )
  })
})

/** Words one side wrote and the other went on from: a write that landed unheard. */
describe('mergedOn', () => {
  test.each([
    [
      'a line, and then more',
      'base\n',
      'base\ntyped\n',
      'base\ntyped\nmore\n',
      'base\ntyped\nmore\n',
    ],
    [
      'the same read the other way',
      'base\n',
      'base\ntyped\nmore\n',
      'base\ntyped\n',
      'base\ntyped\nmore\n',
    ],
    [
      'in a line',
      '# T\n\nalpha\n',
      '# T\n\nalpha typed\n',
      '# T\n\nalpha typed more\n',
      '# T\n\nalpha typed more\n',
    ],
    [
      'a passage',
      'b\n',
      'b\nsome long words here\n',
      'b\nsome long words here and more\n',
      'b\nsome long words here and more\n',
    ],
    [
      'a line in common, then each its own',
      'b\n',
      'b\none\nmine\n',
      'b\none\ntheirs\n',
      'b\none\nmine\ntheirs\n',
    ],
    ['more written before', 'b\n', 'b\ntyped\n', 'b\nmore\ntyped\n', 'b\nmore\ntyped\n'],
    [
      'in the middle of what the other wrote',
      'b\n',
      'b\ntyped words\n',
      'b\nfirst typed words last\n',
      'b\nfirst typed words last\n',
    ],
    ['the same word on both', 'x\n', 'x\nsame\n', 'x\nsame\n', 'x\nsame\n'],
  ])('%s: once', (_, base, local, remote, out) => {
    expect(mergedOn(base, local, remote)).toBe(out)
  })

  test.each([
    ['words apart', 'a\n\nb\n', 'a\nmine\n\nb\n', 'a\n\nb\ntheirs\n', 'a\nmine\n\nb\ntheirs\n'],
    ['two things at one point', 'x\n', 'x\nmilk\n', 'x\neggs\n', 'x\nmilk\neggs\n'],
    ['a deletion', 'one\ntwo\n', 'one\n', 'one\ntwo\nthree\n', 'one\nthree\n'],
  ])('%s: as any merge', (_, base, local, remote, out) => {
    expect(mergedOn(base, local, remote)).toBe(out)
    expect(merge3(base, local, remote).text).toBe(out)
  })

  test('words typed anywhere, the other side going on from them, are there once', () => {
    let seed = 7
    const next = (under: number) => {
      seed = (seed * 48271) % 2147483647
      return seed % under
    }
    const lines = Array.from({ length: 12 }, (_, at) => `line ${at} of the note`)
    for (let round = 0; round < 300; round += 1) {
      const base = `${lines.join('\n')}\n`
      const at = base.indexOf('\n', next(base.length - 2))
      const typed = next(2) ? `\nTYPED${round}` : ` TYPED${round}`
      const local = base.slice(0, at) + typed + base.slice(at)
      const further = next(2) ? ` and on ${round}` : `\nand on ${round}`
      const remote = base.slice(0, at) + typed + further + base.slice(at)
      for (const [one, other] of [
        [local, remote],
        [remote, local],
      ]) {
        const out = mergedOn(base, one!, other!)
        expect(out, `${JSON.stringify(typed)} ${JSON.stringify(further)}`).toBe(remote)
      }
    }
  })
})
