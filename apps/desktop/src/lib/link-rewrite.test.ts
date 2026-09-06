import { describe, expect, test } from 'vitest'
import type { FoundLink } from '@nib/markdown/links'
import { rewriteLinks } from './link-rewrite'

/** Rewrites every link whose target names `wanted`, which is what the index
 *  decides for real; here it is a string comparison so the rewriting itself is
 *  what is under test. */
const pointsAt = (wanted: string) => (link: FoundLink) =>
  link.target
    .replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .endsWith(wanted.toLowerCase())

const move = { from: 'Plan.md', to: 'Roadmap.md' }

describe('rewriting a wikilink', () => {
  test('a bare name becomes the new bare name', () => {
    expect(rewriteLinks('see [[Plan]] now', 'Note.md', move, pointsAt('plan'))).toBe(
      'see [[Roadmap]] now',
    )
  })

  test('an alias, a heading and a block all survive', () => {
    const text = '[[Plan|the plan]] [[Plan#Today]] [[Plan#^abc]]'
    expect(rewriteLinks(text, 'Note.md', move, pointsAt('plan'))).toBe(
      '[[Roadmap|the plan]] [[Roadmap#Today]] [[Roadmap#^abc]]',
    )
  })

  test('a path-qualified link keeps its path, with the new one', () => {
    const deeper = { from: 'ideas/Plan.md', to: 'later/Roadmap.md' }
    expect(rewriteLinks('[[ideas/Plan]]', 'Note.md', deeper, pointsAt('plan'))).toBe(
      '[[later/Roadmap]]',
    )
  })

  test('an extension is kept when the link was written with one', () => {
    expect(rewriteLinks('[[Plan.md]]', 'Note.md', move, pointsAt('plan'))).toBe('[[Roadmap.md]]')
  })

  test('an embed is rewritten like any other link', () => {
    expect(rewriteLinks('![[Plan]]', 'Note.md', move, pointsAt('plan'))).toBe('![[Roadmap]]')
  })

  test('a name with spaces and unicode comes through', () => {
    const renamed = { from: 'Mémo für Später.md', to: 'Später/Mémo neu.md' }
    expect(rewriteLinks('[[Mémo für Später]]', 'Note.md', renamed, () => true)).toBe('[[Mémo neu]]')
  })

  test('a note with no link to it is left entirely alone', () => {
    expect(rewriteLinks('nothing here', 'Note.md', move, pointsAt('plan'))).toBeNull()
    expect(rewriteLinks('[[Other]]', 'Note.md', move, pointsAt('plan'))).toBeNull()
  })

  test('the words around a link are untouched, spaces and all', () => {
    const text = '  a\t[[Plan]]  b\n\n**bold**\n'
    expect(rewriteLinks(text, 'Note.md', move, pointsAt('plan'))).toBe(
      '  a\t[[Roadmap]]  b\n\n**bold**\n',
    )
  })

  test('a link in code is not a link and is not rewritten', () => {
    expect(rewriteLinks('`[[Plan]]`', 'Note.md', move, pointsAt('plan'))).toBeNull()
    expect(rewriteLinks('```\n[[Plan]]\n```', 'Note.md', move, pointsAt('plan'))).toBeNull()
  })

  test('several links on one line are all rewritten', () => {
    expect(rewriteLinks('[[Plan]] and [[Plan|again]]', 'Note.md', move, pointsAt('plan'))).toBe(
      '[[Roadmap]] and [[Roadmap|again]]',
    )
  })
})

describe('rewriting a markdown link', () => {
  test('gets a path relative to the note it is written in', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'later/Roadmap.md' }
    expect(rewriteLinks('[the plan](ideas/Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe(
      '[the plan](later/Roadmap.md)',
    )
  })

  test('climbs out of the folder it is written in when it has to', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'Roadmap.md' }
    expect(rewriteLinks('[x](Plan.md)', 'ideas/Deep/Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](../../Roadmap.md)',
    )
  })

  test('a name in the same folder is written on its own', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'ideas/Roadmap.md' }
    expect(rewriteLinks('[x](Plan.md)', 'ideas/Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](Roadmap.md)',
    )
  })

  test('a space in the new name is encoded rather than left to end the target', () => {
    const renamed = { from: 'Plan.md', to: 'The Road Map.md' }
    expect(rewriteLinks('[x](Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](The%20Road%20Map.md)',
    )
  })

  test('a hash in the new name cannot become a fragment', () => {
    const renamed = { from: 'Plan.md', to: 'C#.md' }
    expect(rewriteLinks('[x](Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe('[x](C%23.md)')
  })

  test('a fragment on the link is left where it was', () => {
    expect(rewriteLinks('[x](Plan.md#today)', 'Note.md', move, pointsAt('plan'))).toBe(
      '[x](Roadmap.md#today)',
    )
  })

  test('a title is left where it was', () => {
    expect(rewriteLinks('[x](Plan.md "A title")', 'Note.md', move, pointsAt('plan'))).toBe(
      '[x](Roadmap.md "A title")',
    )
  })

  test('an angled target is replaced in place', () => {
    const renamed = { from: 'My Plan.md', to: 'Roadmap.md' }
    expect(rewriteLinks('[x](<My Plan.md>)', 'Note.md', renamed, () => true)).toBe(
      '[x](<Roadmap.md>)',
    )
  })
})
