import { TEXT } from '@nib/rooms'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { changes, edited, note } from '../test/markdown'
import { CONTESTED, diverge, excerpt } from './diverge'
import { analyse } from './merge3'
import { seedUpdate } from './seed'
import { textops } from './textops'

const LOCAL_NEWER = { local: 2, remote: 1 }

const REMOTE_NEWER = { local: 1, remote: 2 }

/** Two devices' documents grown from one seed, each edited to its text, and merged:
 *  the CRDT's M, which is what the engine hands `diverge`. */
function crdtMerge(base: string, local: string, remote: string): string {
  const seed = seedUpdate('n', 1, base)
  const docs = [local, remote].map((text, index) => {
    const doc = new Y.Doc()
    doc.clientID = index + 10
    Y.applyUpdateV2(doc, seed)
    textops(doc.getText(TEXT), base, text)
    return doc
  })
  const [one, other] = docs as [Y.Doc, Y.Doc]
  Y.applyUpdateV2(one, Y.encodeStateAsUpdateV2(other))
  return one.getText(TEXT).toJSON()
}

/** What a clean merge of whole lines owes: every line both sides kept and every line
 *  either side added, and no other line. */
function cleanLinesAreWhole(base: string, local: string, remote: string, merge: string) {
  const linesOf = (text: string) => text.split('\n').filter(Boolean)
  const [before, mine, theirs, out] = [base, local, remote, merge].map(linesOf) as [
    string[],
    string[],
    string[],
    string[],
  ]
  const owed = [
    ...mine.filter((line) => !before.includes(line)),
    ...theirs.filter((line) => !before.includes(line)),
    ...before.filter((line) => mine.includes(line) && theirs.includes(line)),
  ]
  return {
    missing: owed.filter((line) => !out.includes(line)),
    extra: out.filter((line) => !owed.includes(line)),
  }
}

describe('diverge', () => {
  test('edits in different paragraphs are clean, and the resolution holds both', () => {
    const base = 'First paragraph here.\n\nSecond paragraph there.\n'
    const local = 'First paragraph, edited here.\n\nSecond paragraph there.\n'
    const remote = 'First paragraph here.\n\nSecond paragraph edited there.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(
      'First paragraph, edited here.\n\nSecond paragraph edited there.\n',
    )
  })

  test('both fixed the same typo: clean, and the fix once, not thethe', () => {
    const base = 'I saw teh cat.'
    const fixed = 'I saw the cat.'
    const merged = crdtMerge(base, fixed, fixed)

    const result = diverge(base, fixed, fixed, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(fixed)
  })

  test('both appended to one list: clean, both kept in the order the CRDT gave', () => {
    const base = '- milk\n'
    const local = '- milk\n- eggs\n'
    const remote = '- milk\n- bread\n'
    const merged = crdtMerge(base, local, remote)

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(merged)
  })

  test('the same word changed two ways: minor, the newer stands', () => {
    const base = 'Meet at the station at noon.'
    const local = 'Meet at the station at one.'
    const remote = 'Meet at the station at two.'

    const newer = diverge(base, local, remote, LOCAL_NEWER)
    expect(newer.verdict).toBe('minor')
    expect(newer.overlaps[0]?.newer).toBe('local')
    expect(newer.resolution).toBe(local)

    const older = diverge(base, local, remote, REMOTE_NEWER, crdtMerge(base, local, remote))
    expect(older.verdict).toBe('minor')
    expect(older.resolution).toBe(remote)
  })

  test('a sentence written two ways: diverged, by size', () => {
    const base = 'We should ship the release on Monday after the review.\n'
    const local = 'Let us hold the release until every reviewer has signed off on it.\n'
    const remote = 'The release goes out Friday morning, whatever the review says.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('diverged')
    expect(result.overlaps.some((overlap) => overlap.asks === 'size')).toBe(true)
    expect(result.overlaps.every((overlap) => overlap.size > 0)).toBe(true)
    expect(result.resolution).toBeNull()
  })

  test('the boundary is CONTESTED characters, inclusive', () => {
    const word = (length: number) => 'x'.repeat(length)
    // One replaced word each side: the ancestor word, and two replacements of the
    // same length, so the size is three times it.
    const fits = Math.floor(CONTESTED / 3)
    const small = diverge(
      `a ${word(fits)} b`,
      `a ${'y'.repeat(fits)} b`,
      `a ${'z'.repeat(fits)} b`,
      LOCAL_NEWER,
    )
    expect(small.overlaps[0]?.size).toBeLessThanOrEqual(CONTESTED)
    expect(small.verdict).toBe('minor')

    const big = fits + 1
    const large = diverge(
      `a ${word(big)} b`,
      `a ${'y'.repeat(big)} b`,
      `a ${'z'.repeat(big)} b`,
      LOCAL_NEWER,
    )
    expect(large.overlaps[0]?.size).toBeGreaterThan(CONTESTED)
    expect(large.verdict).toBe('diverged')
  })

  test('a paragraph deleted on one side and rewritten on the other asks', () => {
    const base = 'Keep this.\n\nBuy milk\n\nKeep that.\n'
    const local = 'Keep this.\n\nKeep that.\n'
    const remote = 'Keep this.\n\nBuy milk and eggs and bread and cheese\n\nKeep that.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('diverged')
    expect(result.overlaps.some((overlap) => overlap.asks === 'block')).toBe(true)
  })

  test('a paragraph deleted on one side and a typo fixed in it on the other does not', () => {
    const base = 'Keep this.\n\nBuy mlik\n\nKeep that.\n'
    const local = 'Keep this.\n\nKeep that.\n'
    const remote = 'Keep this.\n\nBuy milk\n\nKeep that.\n'

    expect(diverge(base, local, remote, LOCAL_NEWER).verdict).not.toBe('diverged')
  })

  test('a list item deleted while the other side appended to it asks, touching or not', () => {
    const base = '- one\n- buy milk\n- three\n'
    const local = '- one\n- three\n'
    const remote = '- one\n- buy milk, eggs, bread and some cheese\n- three\n'

    expect(diverge(base, local, remote, REMOTE_NEWER).verdict).toBe('diverged')
  })

  test('front matter the merge would break asks', () => {
    const base = '---\na: 1\n---\nb: 2\n'
    const local = '---\na: 1\nb: 2\n---\n'
    const remote = '---\na: 1\n---\n# heading\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.broken).toBe('front-matter')
    expect(result.verdict).toBe('diverged')
  })

  test('a fence the merge would leave open asks', () => {
    const base = 'A long first paragraph that nobody touches at all.\nqq\n'
    const local = '```\nA long first paragraph that nobody touches at all.\n```\n'
    const remote = 'A long first paragraph that nobody touches at all.\nzz\n'

    const result = diverge(base, local, remote, REMOTE_NEWER)
    expect(result.broken).toBe('fence')
    expect(result.verdict).toBe('diverged')
  })

  test('the excerpt is the first contested passage of each side, the differences marked', () => {
    const base = 'Intro.\n\nWe should ship the release on Monday after the review.\n\nOutro.\n'
    const local =
      'Intro.\n\nLet us hold the release until every reviewer has signed off.\n\nOutro.\n'
    const remote =
      'Intro.\n\nThe release goes out Friday morning, whatever the review says.\n\nOutro.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    const shown = excerpt(base, local, remote, result.overlaps)

    expect(shown.local.text).toBe('Let us hold the release until every reviewer has signed off.')
    expect(shown.remote.text).toBe('The release goes out Friday morning, whatever the review says.')
    expect(shown.local.marks.length).toBeGreaterThan(0)
    expect(shown.remote.marks.length).toBeGreaterThan(0)
    for (const [from, to] of [...shown.local.marks, ...shown.remote.marks]) {
      expect(from).toBeLessThan(to)
    }
  })

  test('the marks are whole words, and only the words that differ', () => {
    const base =
      'Intro.\n\nWe meet on the old bridge at noon with the whole team today.\n\nOutro.\n'
    const local =
      'Intro.\n\nWe meet on the new bridge at one with the whole team today.\n\nOutro.\n'
    const remote =
      'Intro.\n\nWe meet on the stone bridge at two with the whole team tomorrow.\n\nOutro.\n'

    const shown = excerpt(base, local, remote, diverge(base, local, remote, LOCAL_NEWER).overlaps)
    const marked = (side: { text: string; marks: [number, number][] }) =>
      side.marks.map(([from, to]) => side.text.slice(from, to))

    expect(marked(shown.local)).toEqual(['new', 'one', 'today'])
    expect(marked(shown.remote)).toEqual(['stone', 'two', 'tomorrow'])
  })

  test("a minor overlap keeps the newer side's words where the CRDT ordered them otherwise", () => {
    // Found by the simulator (seed 45): the CRDT put the local words before the
    // remote ones at the overlap, and laying the corrections onto its text as a merge
    // of their own lost the local words the newer side had written.
    const base = 'We ship on Monday after the review.\n\n- milk\n- eggs\n'
    const local = 'We ship on Monday after mk8z after the review.\n\n- milk milk the mk3z'
    const remote = 'We mk15z on eggs the ship on Monday after the mk17z mk27z plan milk'
    const merged =
      'We mk15z on eggs the ship on Monday after mk8z after the  milk the mk3zmk17z mk27z plan milk'

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('minor')
    for (const word of ['mk3z', 'mk8z', 'mk15z']) expect(result.resolution).toContain(word)
  })

  test('a long line is cut down to the passage and some context', () => {
    const filler = 'word '.repeat(200)
    const base = `${filler}alpha beta gamma ${filler}`
    const local = `${filler}alpha BETA-ONE gamma ${filler}`
    const remote = `${filler}alpha BETA-TWO gamma ${filler}`

    const shown = excerpt(base, local, remote, diverge(base, local, remote, LOCAL_NEWER).overlaps)
    expect(shown.local.text.length).toBeLessThan(400)
    expect(shown.local.text).toContain('BETA-ONE')
  })

  const distinctTimes = fc
    .tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }))
    .filter(([one, other]) => one !== other)

  test('property: diverge(B, L, B) is clean, and resolves to L', () => {
    fc.assert(
      fc.property(note, changes, (base, mine) => {
        const local = edited(base, mine)
        const result = diverge(base, local, base, LOCAL_NEWER)
        expect(result.verdict).toBe('clean')
        expect(result.resolution).toBe(local)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: disjoint edits are clean and the resolution holds both', () => {
    fc.assert(
      fc.property(note, note, changes, changes, (first, second, mine, theirs) => {
        const separator = '\n\n<!-- apart -->\n\n'
        const base = `${first}${separator}${second}`
        const local = `${edited(first, mine)}${separator}${second}`
        const remote = `${first}${separator}${edited(second, theirs)}`

        const result = diverge(base, local, remote, LOCAL_NEWER)
        expect(result.overlaps).toEqual([])
        // A fence opened on one side of the separator and closed on the other is
        // the one way two disjoint edits can still break something together.
        if (result.broken === null) {
          expect(result.verdict).toBe('clean')
          expect(result.resolution).toBe(
            `${edited(first, mine)}${separator}${edited(second, theirs)}`,
          )
        }
      }),
      { numRuns: 1000 },
    )
  })

  test('a passage the older side moved out of an overlap is said once, not twice', () => {
    // Found by the engine's simulated runs: the account's side moved "mk18z ship mk8z
    // on" further along, and the newer side's version of the overlap still held it
    // where it was. The newer side standing would have said it twice.
    const base =
      'We milk mk18z ship mk8z on review plan we review mk16z ship mk20z on mk9z milk review on Monday after the review.\n\n- milk\n'
    const local =
      'We milk mk18z ship mk8z on review mk32z plan we review mk16z ship mk20z on mk9z milk review on Monday milk\n'
    const remote =
      'We milk plan mk30z plan on after mk18z ship mk8z on mk20z on mk9z milk review after the review.\n\n- milk\n'
    const merged = crdtMerge(base, local, remote)

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('minor')
    for (const word of ['mk18z', 'mk8z', 'mk32z', 'mk30z']) {
      expect(result.resolution?.split(word).length, word).toBe(2)
    }
  })

  test('a few words two devices each put back over a deletion are said once', () => {
    // Also found by the engine's runs: both devices kept their own version over a
    // deletion, so each typed "mk4z we mk2z the" back - one as an insertion, the other
    // replacing the next word - and the CRDT holds two copies of one passage.
    const base = '# Ideas\n\nA long paragraph review monday about mk3z plan on\n'
    const local =
      '# Ideas\n mk25z monday\nA long paragraph review monday mk4z we mk2z the mk36z we about what comes\n'
    const remote =
      '# Ideas\n\nA long paragraph review monday mk4z we mk2z the about mk37z what comes next.\n'

    const result = diverge(base, local, remote, REMOTE_NEWER, crdtMerge(base, local, remote))
    expect(result.verdict).not.toBe('clean')
    expect(result.resolution?.split('mk4z').length ?? 2).toBe(2)
  })

  test('a passage two devices each moved, which the CRDT holds twice, is said once (#436)', () => {
    // Walk seed 207384677: two devices each settled an earlier meeting by moving "eggs
    // mk1z", so each typed it again as an insertion of its own and the CRDT's merge holds
    // two copies side by side. Falling back to the CRDT's text kept both.
    const base = 'We mk5z ship on Monday after eggs mk1z mk13z monday ship\n\n- milk\n- eggs\n'
    const local =
      'We mk5z ship milk mk7z ship ship review plan mk16z we review on Monday review milk mk26z plan milk the mk18z mk8z on we after eggs mk1z mk13z monday ship mk11z\n'
    const remote =
      'We mk5z ship on Monday after mk14z milk plan eggs mk1z mk13z monday ship\n\n- milk\n- milk review monday mk6z eggs\n'
    const merged =
      'We mk5z ship milk mk7z ship ship review plan mk16z we review on Monday mk14z milk plan review milk mk26z plan milk the mk18z mk8z on we after eggs mk1zeggs mk1z mk13z monday shipmilk review monday mk6z  mk11z\n'
    expect(merged.split('mk1z').length).toBe(3)

    const result = diverge(base, local, remote, REMOTE_NEWER, merged)
    expect(result.verdict).toBe('minor')
    for (const word of ['mk1z', 'mk5z', 'mk6z', 'mk11z', 'mk13z', 'mk14z', 'mk26z']) {
      expect(result.resolution?.split(word).length, word).toBe(2)
    }
  })

  test("the CRDT's merge stands where the text merge would say more twice than it does", () => {
    // Walk seed 7346, which the check above first broke: two words the CRDT set side by
    // side read to it as a repeat, and the text merge it fell back to said mk13z twice.
    const base = 'We ship the monday after mk16z ship on Monday mk6z after mk13z the review.'
    const local = 'We ship the monday after mk16z ship on Monday mk6z after mk19z monday themk13z '
    const remote =
      'We ship the monday after mk16z ship on Monday mk6z after mk30z on mk13z the review. on mk24z'
    const merged =
      'We ship the monday after mk16z ship on Monday mk6z after mk19z monday mk30z on the on mk24zmk13z '

    const result = diverge(base, local, remote, REMOTE_NEWER, merged)
    expect(result.resolution?.split('mk13z').length).toBe(2)
  })

  test('a passage two devices each put back over a deletion, at one point, is said once (#530)', () => {
    // Walk seed 611000297: one device kept a day's words over a deletion as the newer
    // side of a meeting, the other answered Keep mine; each wrote the words again, and
    // the one device's words there ended with them where the other's began with them.
    const base = ''
    const local = 'mk3z on\nmk17z plan milk mk25z the we after'
    const remote = 'we mk10zmk3z on'
    const merged = 'we mk10zmk3z onmk3z on\nmk17z plan milk mk25z the we after'
    expect(merged.split('mk3z').length).toBe(3)

    const result = diverge(base, local, remote, REMOTE_NEWER, merged)
    expect(result.resolution).toBe('we mk10zmk3z on\nmk17z plan milk mk25z the we after')
  })

  test('a word both sides moved, each to a place of its own, is said once, where the newer put it (#530)', () => {
    // Walk seed 622002257: another program and the device each moved mk15z; the device's
    // words were older, and its new place for it goes.
    const base = 'review on review mk15z review'
    const file = 'review mk31z we review milk ship on review mk15z'
    const ours = 'review on mk15z we review mk30z review mk27z ship review on'

    expect(diverge(base, file, ours, LOCAL_NEWER).resolution).toBe(
      'review mk31z we we review milk ship on review mk15z mk27z ship review on',
    )
    expect(diverge(base, file, ours, REMOTE_NEWER).resolution).toBe(
      'review mk31z we mk15z we review mk30z review mk27z ship review on',
    )
  })

  test('a task each side added, either side of one both deleted, leaves the rest alone', () => {
    // One device added a task at the top and the other at the bottom, and both deleted
    // the same one. Read letter by letter, the line added at the top shifts every task
    // below it down by one, so both sides seemed to rewrite the deleted line.
    const base = '- [ ] alpha\n- [ ] gone item\n- [ ] beta\n- [ ] gamma\n'
    const local = '- [ ] call Ann\n- [ ] alpha\n- [ ] beta\n- [ ] gamma\n'
    const remote = '- [ ] alpha\n- [ ] beta\n- [ ] gamma\n- [ ] call Eve\n'
    const merged = crdtMerge(base, local, remote)

    for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
      for (const crdt of [undefined, merged]) {
        const result = diverge(base, local, remote, times, crdt)
        expect(result.verdict).toBe('clean')
        for (const task of ['alpha', 'beta', 'gamma']) {
          expect(result.resolution).toContain(`- [ ] ${task}\n`)
        }
        expect(result.resolution).toMatch(/^(- \[ \] )?call Ann\n.*call Eve\n$/s)
        expect(result.resolution).not.toContain('gone item')
      }
    }
  })

  test('a task one side added above the one the other side ticked leaves the tick where it was', () => {
    // Read letter by letter, the added task's box lined up with the ticked one's, and
    // the tick landed on the new task.
    const base = '- [ ] Call Ann\n- [ ] Pay rent\n'
    const local = '- [ ] Call Bob\n- [ ] Call Ann\n- [ ] Pay rent\n'
    const remote = '- [x] Call Ann\n- [ ] Pay rent\n'

    for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
      const result = diverge(base, local, remote, times)
      expect(result.verdict).toBe('clean')
      expect(result.resolution).toBe('- [ ] Call Bob\n- [x] Call Ann\n- [ ] Pay rent\n')
    }
  })

  test.each([
    ['- [ ] milk\n', '- [x] milk\n', '- [ ] eggs\n- [x] milk\n', '- [ ] eggs\n- [x] milk\n'],
    [
      '- [ ] a\n- [ ] b\n',
      '- [ ] a\n- [ ] new\n- [x] b\n',
      '- [ ] a\n- [x] b\n',
      '- [ ] a\n- [ ] new\n- [x] b\n',
    ],
    [
      '- [ ] pay bike\n- [ ] call book\n',
      '- [ ] pay bike\n- [ ] rent buy\n- [x] call book\n',
      '- [x] pay bike\n- [x] call book\n',
      '- [x] pay bike\n- [ ] rent buy\n- [x] call book\n',
    ],
  ])(
    'a task added above one both ticked leaves its own box alone (%j)',
    (base, local, remote, both) => {
      // Read letter by letter, the ticked task's old box became the new task's box, and
      // the other side's tick landed on the new task.
      const merged = crdtMerge(base, local, remote)
      for (const [one, other] of [
        [local, remote],
        [remote, local],
      ] as const) {
        for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
          for (const crdt of [undefined, merged]) {
            const result = diverge(base, one, other, times, crdt)
            expect(result.verdict).toBe('clean')
            expect(result.resolution).toBe(both)
          }
        }
      }
    },
  )

  test.each([
    // A word typed where the other side took a space out.
    ['Pay rent, call mum.\n', 'Pay rent, now call mum.\n', 'Pay rent,call mum.\n'],
    ['Pay rent. Call mum.', 'Pay rent. Ann Call mum.', 'Pay rent.Call mum.'],
    ['- [ ] task \n', '- [ ] é task\n', '- [ ] task x\n'],
    // A sentence each side moved into a paragraph of its own.
    [
      'Pay rent.\n\nCall mum.\n\nBuy milk.\n',
      'Pay rent. Call mum.\n\n\nBuy milk.\n',
      'Pay rent.\n\n\nCall mum. Buy milk.\n',
    ],
    // A paragraph split on both sides, one of them also taking a blank line out.
    [
      'rain hard it on fell home so.\n\nmet the home. so fell so home cat dark.\n',
      ' met the home.\n\nso fell so home cat dark.\n',
      'rain hard it on fell home so.\nmet the home.\n\nso fell so home cat dark.\n',
    ],
    ['- Call Bob', '- L1 task y\n- L2 Bob', '- R1 Call Bob\n- R2 task z'],
  ])(
    'a clean merge runs no two words together and says nothing twice (%j)',
    (base, local, remote) => {
      const wordsOf = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? []
      const count = (text: string) => {
        const counts = new Map<string, number>()
        for (const word of wordsOf(text)) counts.set(word, (counts.get(word) ?? 0) + 1)
        return counts
      }
      const merged = crdtMerge(base, local, remote)
      for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
        for (const crdt of [undefined, merged]) {
          const result = diverge(base, local, remote, times, crdt)
          if (result.verdict !== 'clean') continue
          const [before, mine, theirs] = [base, local, remote].map(count) as [
            Map<string, number>,
            Map<string, number>,
            Map<string, number>,
          ]
          for (const [word, times] of count(result.resolution ?? '')) {
            const most = Math.max(mine.get(word) ?? 0, theirs.get(word) ?? 0)
            const both = Math.min(mine.get(word) ?? 0, theirs.get(word) ?? 0)
            expect(times, word).toBeLessThanOrEqual(
              most + Math.max(0, both - (before.get(word) ?? 0)),
            )
          }
        }
      }
    },
  )

  test.each([
    // A line one side took out and the other added to, beside a line the other added.
    [
      '- cafe\n- now tag uber Z\n',
      '- cafe\n- now tag uber Z Z\neggs\n',
      'noon cafe now a R eggs eggs resume noon call call brown and cafe\n- cafe\n',
    ],
    [
      'top\n- cafe\n- now tag uber Z\n',
      'top\n- cafe\n- now tag uber Z Z\neggs\n',
      'top\nsome long new line written here ending in cafe\n- cafe\n',
    ],
    // A box ticked on one side where the other wrote over its bracket.
    [
      '- [ ] R\n- [x] rent noon\n- [x] to naïve note milk\n',
      '- [ 😀 R\n- [x] rent noon\n- [x] to naïve note milk\n',
      '- [x] R\n- [x] to naïve note milk\n',
    ],
  ])('a merge that keeps a version writes only lines someone wrote (%j)', (base, local, remote) => {
    // Kept both, the one side's words ran into the line after the one the other took
    // out (` Zeggs`), or two replacements ran into one token (`[x😀`).
    const lines = new Set([base, local, remote].flatMap((text) => text.split('\n')))
    for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
      const result = diverge(base, local, remote, times)
      if (result.resolution === null) continue
      expect(result.resolution.split('\n').filter((line) => !lines.has(line))).toEqual([])
    }
  })

  test('tasks each side added beside ones the other deleted stay tasks of their own', () => {
    // Two added tasks ran together into one line and an emptied box was left behind.
    const base = '- [ ] alpha\n- [ ] beta\n- [ ] new item\n- [ ] gamma\n'
    const local = '- [ ] new item\n- [ ] read a book\n'
    const remote = '- [ ] alpha\n- [ ] beta\n- [ ] new item\n- [ ] fix gamma\n- [ ] gamma\n'

    for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
      const result = diverge(base, local, remote, times)
      expect(result.verdict).toBe('clean')
      expect(result.resolution).toMatch(
        /^- \[ \] new item\n(- \[ \] fix gamma\n- \[ \] read a book|- \[ \] read a book\n- \[ \] fix gamma)\n$/,
      )
    }
  })

  test.each([
    // A line added above a line the other side rewrote.
    ['- call Ann\n', '- L call Ann z\n- call Ann\n', '- R call Ann x\n'],
    // A line rewritten on one side, lines added either side of it on the other.
    ['alpha\n', 'L Book dentist z\n', 'R beta y\nalpha\nR Pay rent z\n'],
    // A line emptied on one side, rewritten and added to on the other.
    ['Renew passport\n', '\n', 'R Renew passport z\nR alpha z\n'],
  ])(
    'lines added or rewritten on both sides around one line come out whole (%j)',
    (base, local, remote) => {
      for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
        const result = diverge(base, local, remote, times)
        if (result.verdict !== 'clean') continue
        expect(cleanLinesAreWhole(base, local, remote, result.resolution ?? '')).toEqual({
          missing: [],
          extra: [],
        })
      }
    },
  )

  test('a blank line one side took out and the other wrote in is settled as written', () => {
    const base = 'Intro.\n\nOutro.\n'
    const local = 'Intro.\nOutro.\n'
    const remote =
      'Intro.\nA line written into the blank one, long enough to be a sentence.\nOutro.\n'

    for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
      const result = diverge(base, local, remote, times)
      expect(result.verdict).not.toBe('diverged')
      expect(result.resolution).toBe(remote)
    }
  })

  test('property: boxes ticked on one side and tasks added or deleted on the other, merged clean, stay on their tasks', () => {
    const items = ['milk', 'eggs', 'Pay rent', 'Call mum', 'Book dentist', 'alpha', 'beta']
    const added = ['Water plants', 'wash car', 'fix the bike', 'Renew passport']
    const box = (ticked: boolean) => (ticked ? '- [x] ' : '- [ ] ')
    const sideOf = (count: number) =>
      fc.record({
        // Each task kept as it was, ticked the other way, or taken out.
        does: fc.array(fc.constantFrom('keep', 'tick', 'drop'), {
          minLength: count,
          maxLength: count,
        }),
        adds: fc.array(fc.tuple(fc.nat(10), fc.constantFrom(...added), fc.boolean()), {
          maxLength: 2,
        }),
      })
    const tasks = fc
      .uniqueArray(fc.tuple(fc.constantFrom(...items), fc.boolean()), {
        minLength: 1,
        maxLength: 5,
        selector: ([item]) => item,
      })
      .chain((list) =>
        fc.tuple(fc.constant(list), sideOf(list.length), sideOf(list.length), fc.boolean()),
      )

    fc.assert(
      fc.property(tasks, ([list, mine, theirs, ends]) => {
        const text = (lines: readonly string[]) => lines.join('\n') + (ends ? '\n' : '')
        const sideText = (side: typeof mine, tag: string) => {
          const lines: string[] = []
          list.forEach(([item, ticked], at) => {
            if (side.does[at] !== 'drop')
              lines.push(box(side.does[at] === 'tick' ? !ticked : ticked) + item)
          })
          side.adds.forEach(([at, item, ticked], index) =>
            lines.splice(at % (lines.length + 1), 0, `${box(ticked)}${tag}${index} ${item}`),
          )
          return lines
        }
        const local = sideText(mine, 'L')
        const remote = sideText(theirs, 'R')
        const owed = [
          ...list.flatMap(([item, ticked], at) => {
            const [one, other] = [mine.does[at], theirs.does[at]]
            if (one === 'drop' || other === 'drop') return []
            return [box(one === 'tick' || other === 'tick' ? !ticked : ticked) + item]
          }),
          ...local.filter((line) => / L\d /.test(line)),
          ...remote.filter((line) => / R\d /.test(line)),
        ]
        const base = text(list.map(([item, ticked]) => box(ticked) + item))
        for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
          const result = diverge(base, text(local), text(remote), times)
          if (result.verdict !== 'clean') continue
          const lines = (result.resolution ?? '').split('\n').filter(Boolean)
          expect(lines.filter((line) => !owed.includes(line))).toEqual([])
          expect(owed.filter((line) => !lines.includes(line))).toEqual([])
        }
      }),
      { numRuns: 500 },
    )
  })

  test('property: tasks added and deleted on both sides, merged clean, are each whole', () => {
    // Every line both sides kept, every line either side added, and nothing else: no
    // line deleted on either side, and none run together or left half written.
    const items = ['Buy milk', 'Pay rent', 'Call mum', 'Book dentist', 'alpha', 'beta', 'gamma']
    const pool = [...items, 'new task', 'new item', 'call Ann', 'call Eve', 'read a book']
    const sideOf = (lines: readonly string[]) =>
      fc
        .tuple(
          fc.array(fc.boolean(), { minLength: lines.length, maxLength: lines.length }),
          fc.array(fc.tuple(fc.nat(10), fc.constantFrom(...pool), fc.constantFrom('x', 'y', 'z')), {
            maxLength: 2,
          }),
        )
        .map(([keep, added]) => {
          const out: (string | [string, string])[] = lines.filter((_, at) => keep[at])
          for (const [at, item, tag] of added) out.splice(at % (out.length + 1), 0, [item, tag])
          return out
        })
    const tasks = fc
      .uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: 6 })
      .chain((lines) => fc.tuple(fc.constant(lines), sideOf(lines), sideOf(lines)))

    fc.assert(
      fc.property(fc.constantFrom('- [ ] ', '- ', ''), tasks, (mark, [lines, mine, theirs]) => {
        const text = (list: readonly (string | [string, string])[], side: string) =>
          list
            .map((one) => (typeof one === 'string' ? one : `${side} ${one[0]} ${one[1]}`))
            .map((one) => `${mark}${one}\n`)
            .join('')
        const base = text(lines, '')
        const local = text(mine, 'L')
        const remote = text(theirs, 'R')
        for (const times of [LOCAL_NEWER, REMOTE_NEWER]) {
          const result = diverge(base, local, remote, times)
          if (result.verdict !== 'clean') continue
          expect(cleanLinesAreWhole(base, local, remote, result.resolution ?? '')).toEqual({
            missing: [],
            extra: [],
          })
        }
      }),
      { numRuns: 1000 },
    )
  })

  test('words each side wrote anew in a place of its own are both kept, the same or not', () => {
    const base = 'First line.\n\nSecond line.\n'
    const local = 'First line, the plan.\n\nSecond line.\n'
    const remote = 'First line.\n\nSecond line, the plan.\n'

    expect(diverge(base, local, remote, REMOTE_NEWER).resolution).toBe(
      'First line, the plan.\n\nSecond line, the plan.\n',
    )
  })

  test('a line one side wrote that the other wrote too and went on from is not asked about', () => {
    // Found by the conflict drive under v2: a note closed offline and opened again
    // against a file nib wrote before the line, so one side is the line and the other
    // the line and what came after it.
    const base = '# Plan\n\nthe line both of them start from\n'
    const line = '\nMachine one, from the train: the platform moved to track nine.\n'
    const local = `${base}${line}`
    const remote = `${base}${line}\nMeanwhile at the desk we drafted the budget for spring.\n`

    for (const times of [REMOTE_NEWER, { local: 2, remote: 1 }]) {
      const result = diverge(base, local, remote, times)
      expect(result.verdict).not.toBe('diverged')
      expect(result.resolution).toBe(remote)
    }
  })

  test('property: diverge(B, L, R) and diverge(B, R, L) give the same verdict', () => {
    fc.assert(
      fc.property(note, changes, changes, distinctTimes, (base, mine, theirs, [one, other]) => {
        const local = edited(base, mine)
        const remote = edited(base, theirs)
        const forward = diverge(base, local, remote, { local: one, remote: other })
        const backward = diverge(base, remote, local, { local: other, remote: one })

        expect(backward.verdict).toBe(forward.verdict)
        if (forward.resolution !== null)
          expect(backward.resolution).toHaveLength(forward.resolution.length)
      }),
      { numRuns: 2000 },
    )
  })

  test('property: with the CRDT merge in hand, the resolution keeps its order and drops no word', () => {
    let same = 0
    let clean = 0
    fc.assert(
      fc.property(note, changes, changes, distinctTimes, (base, mine, theirs, [one, other]) => {
        const local = edited(base, mine)
        const remote = edited(base, theirs)
        const merged = crdtMerge(base, local, remote)
        const result = diverge(base, local, remote, { local: one, remote: other }, merged)
        if (result.verdict !== 'clean' || result.resolution === null) return
        clean += 1

        // Clean: nothing overlapped, so everything either side wrote is in the note,
        // whole, and in most runs the note is simply the CRDT's merge.
        const { alone } = analyse(base, local, remote)
        for (const edit of [...alone.local, ...alone.remote]) {
          expect(result.resolution).toContain(edit.insert)
        }
        if (result.resolution === merged) same += 1

        const doc = new Y.Doc()
        doc.getText(TEXT).insert(0, merged)
        textops(doc.getText(TEXT), merged, result.resolution)
        expect(doc.getText(TEXT).toJSON()).toBe(result.resolution)
      }),
      { numRuns: 1000 },
    )
    // The CRDT's own order is kept wherever it is only a matter of order.
    expect(same).toBeGreaterThan(clean * 0.9)
  })

  test('a line replaced by a paste of long lines on each side is read in about the time of one diff', () => {
    // Each pasted line was compared letter by letter with the line it replaced, two
    // unrelated stretches at a time: 25 seconds for this one.
    const words = ['the', 'cat', 'sat', 'on', 'mat', 'we', 'met', 'at', 'noon', 'it', 'was', 'late']
    let seed = 1
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const line = () => {
      let text = ''
      while (text.length < 990) text += `${words[Math.floor(next() * words.length)]} `
      return text.slice(0, 990)
    }
    const paste = () => `${Array.from({ length: 400 }, line).join('\n')}\n`
    const base = `${line()}\n`
    const local = paste()
    const remote = paste()

    const started = performance.now()
    diverge(base, local, remote, LOCAL_NEWER)
    expect(performance.now() - started).toBeLessThan(2_500)
  })

  test('a word changed at each end of a hundred kilobytes is clean', () => {
    const paragraph = 'The plan for tomorrow is to write, then to rest, then to write again.\n\n'
    const base = paragraph.repeat(Math.ceil(100_000 / paragraph.length))
    const local = base.replace('rest', 'sleep')
    const last = base.lastIndexOf('write')
    const remote = `${base.slice(0, last)}draw${base.slice(last + 'write'.length)}`

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.overlaps).toEqual([])
    expect(result.resolution).toContain('sleep')
    expect(result.resolution).toContain('draw again')
  })
})
