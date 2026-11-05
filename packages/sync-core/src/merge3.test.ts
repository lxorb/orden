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

describe('mergedOn takes nothing from either side', () => {
  const baseOf = (lines: number, ending: boolean) => {
    const made = Array.from({ length: lines }, (_, at) => `b${at}x`).join('\n')
    return ending ? `${made}\n` : made
  }

  test.each([
    ['a line break first, the other side a line', 'a\n', 'a\n\nmine\n', 'a\nfoo\n'],
    ['the same with a heading', 'base\n', 'base\n\nmine\n', 'base\n# Agent heading\n'],
    ['one character the other side wrote', 'base\n', 'base\n\nmine\n', 'base\nX'],
  ])('%s', (_, base, local, remote) => {
    const out = mergedOn(base, local, remote)
    expect(out).toBe(merge3(base, local, remote).text)
  })

  test.each([
    ['a number', 'x y', 'x 5 y', 'x 50 y'],
    ['a short word another starts with', 'x y', 'x no y', 'x not sure y'],
    ['a word another ends with', 'x y', 'x art y', 'x start y'],
    ['a passage inside a longer word', 'x y', 'x wordsmith y', 'x a wordsmithing y'],
  ])("a reader's word is theirs: %s", (_, base, local, remote) => {
    expect(mergedOn(base, local, remote)).toBe(merge3(base, local, remote).text)
  })

  test.each([
    ['a whole word first', 'x y', 'x no y', 'x no way y', 'x no way y'],
    ['a whole word last', 'x y', 'x way y', 'x no way y', 'x no way y'],
    ['a whole line', 'x\n', 'x\nmilk\n', 'x\nmilk\neggs\n', 'x\nmilk\neggs\n'],
    ['words ending in a mark', 'x y', 'x - y', 'x - b y', 'x - b y'],
  ])('what is whole is said once: %s', (_, base, local, remote, out) => {
    expect(mergedOn(base, local, remote)).toBe(out)
  })

  test('words taken out of what the other side went on from come back', () => {
    expect(mergedOn('b\n', 'b\ntyped\n', 'b\ntyped more\n')).toBe('b\ntyped more\n')
  })

  test('against merge3 over many shapes: no insert lost, no deletion undone, no doubling', () => {
    let seed = 20261104
    const next = (under: number) => {
      seed = (seed * 48271) % 2147483647
      return seed % under
    }
    let word = 0
    const fresh = () => `T${(word += 1)}z`
    const shapes = [
      (one: string) => one,
      (one: string) => `\n${one}`,
      (one: string) => ` ${one}`,
      (one: string) => `${one} `,
      (one: string) => `${one}\n`,
      (one: string) => `\n${one}\n`,
      (one: string) => `# ${one}\n`,
    ]
    const shaped = (one: string) => shapes[next(shapes.length)]!(one)
    const edit = (text: string, into: Set<string>, gone: Set<string>) => {
      let out = text
      for (let times = next(3) + 1; times > 0; times -= 1) {
        const lines = out.split('\n')
        if (next(4) === 0 && lines.length > 2) {
          const at = next(lines.length - 1)
          const line = lines[at]!
          if (/^b\d+x$/.test(line)) gone.add(line)
          lines.splice(at, 1)
          out = lines.join('\n')
          continue
        }
        const token = fresh()
        into.add(token)
        const at = next(2) ? out.length : out.indexOf('\n', next(Math.max(out.length, 1)))
        const point = at < 0 ? out.length : at
        out = out.slice(0, point) + shaped(token) + out.slice(point)
      }
      return out
    }

    const count = (text: string, token: string) => text.split(token).length - 1
    let goneOn = 0
    for (let round = 0; round < 40_000; round += 1) {
      const base = baseOf(next(8) + 1, next(4) !== 0)
      const inLocal = new Set<string>()
      const inRemote = new Set<string>()
      const gone = new Set<string>()
      const local = edit(base, inLocal, gone)
      const onward = next(2) === 0
      if (onward) goneOn += 1
      const remote = onward ? edit(local, inRemote, gone) : edit(base, inRemote, gone)
      const told = `${JSON.stringify(base)} ${JSON.stringify(local)} ${JSON.stringify(remote)}`

      for (const [one, other] of [
        [local, remote],
        [remote, local],
      ] as const) {
        const out = mergedOn(base, one, other)
        const reference = merge3(base, one, other).text
        for (const token of [...inLocal, ...inRemote]) {
          const here = count(out, token)
          const there = count(reference, token)
          if ((there > 0 && here === 0) || here > Math.max(there, 1)) {
            expect.fail(`${token}: ${here} here, ${there} in merge3, in ${told}`)
          }
          if (onward && inLocal.has(token) && here > 1 && remote.includes(token)) {
            const wholeRemote = count(remote, token)
            if (wholeRemote === 1 && there <= 1) expect.fail(`${token} doubled in ${told}`)
          }
        }
        for (const line of gone) {
          if (count(reference, line) === 0 && count(out, line) > 0) {
            expect.fail(`${line} came back in ${told}`)
          }
        }
      }
    }
    expect(goneOn).toBeGreaterThan(15_000)
  }, 120_000)
})
