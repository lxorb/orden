import { describe, expect, test } from 'vitest'
import { formatLink, isLinkFormat, LINK_FORMATS, linkWriting, setLinkWriting } from './link-format'
import { linkTo } from './composer'
import { citation } from './pdf/highlights'
import { rewriteLinks } from './import/rewrite'

const PLAN = { name: 'Plan', path: 'ideas/Plan.md', from: 'journal/Monday.md' }

describe('a link to a note', () => {
  test('is a wikilink until the setting says otherwise, which is what nib always wrote', () => {
    expect(formatLink(PLAN, 'wikilink')).toBe('[[Plan]]')
    expect(LINK_FORMATS[0]).toBe('wikilink')
  })

  test('shows its own words only when they are not the name already', () => {
    expect(formatLink({ ...PLAN, shown: 'the plan' }, 'wikilink')).toBe('[[Plan|the plan]]')
    expect(formatLink({ ...PLAN, shown: 'Plan' }, 'wikilink')).toBe('[[Plan]]')
  })

  test('carries the heading or the block after the target', () => {
    expect(formatLink({ ...PLAN, fragment: 'Next steps' }, 'wikilink')).toBe('[[Plan#Next steps]]')
    expect(formatLink({ ...PLAN, fragment: '^a1b2c3' }, 'wikilink')).toBe('[[Plan#^a1b2c3]]')
  })

  test('is an embed where it was asked for as one', () => {
    expect(formatLink({ ...PLAN, embed: true }, 'wikilink')).toBe('![[Plan]]')
    expect(formatLink({ ...PLAN, embed: true }, 'shortest')).toBe('![Plan](Plan.md)')
  })
})

describe('the three markdown spellings', () => {
  test('write the shortest name, the path from here, or the path from the top', () => {
    expect(formatLink(PLAN, 'shortest')).toBe('[Plan](Plan.md)')
    expect(formatLink(PLAN, 'relative')).toBe('[Plan](../ideas/Plan.md)')
    expect(formatLink(PLAN, 'absolute')).toBe('[Plan](ideas/Plan.md)')
  })

  test('always show something, since a markdown link with no words shows none', () => {
    expect(formatLink({ ...PLAN, shown: 'the plan' }, 'absolute')).toBe('[the plan](ideas/Plan.md)')
    expect(formatLink(PLAN, 'absolute')).toContain('[Plan]')
  })

  test('encode what a destination cannot hold as written', () => {
    expect(formatLink({ name: 'My Plan', path: 'My Plan.md' }, 'absolute')).toBe(
      '[My Plan](My%20Plan.md)',
    )
  })

  test('write a heading as the anchor an exported or published page gives it', () => {
    expect(formatLink({ ...PLAN, fragment: 'Next steps' }, 'absolute')).toBe(
      '[Plan](ideas/Plan.md#next-steps)',
    )
  })

  test('leave a block name and a page number exactly as they were written', () => {
    expect(formatLink({ ...PLAN, fragment: '^a1b2c3' }, 'absolute')).toBe(
      '[Plan](ideas/Plan.md#^a1b2c3)',
    )
    expect(formatLink({ name: 'paper.pdf', fragment: 'page=3' }, 'shortest')).toBe(
      '[paper.pdf](paper.pdf#page=3)',
    )
  })

  /** A caller that knows only a name cannot say where the note is, so the shortest
   *  spelling is the closest true answer - and it is a working link either way,
   *  since a bare name resolves against the note it is written in. */
  test('fall back to the name where nothing knows the path', () => {
    expect(formatLink({ name: 'Plan' }, 'relative')).toBe('[Plan](Plan.md)')
    expect(formatLink({ name: 'Plan' }, 'absolute')).toBe('[Plan](Plan.md)')
  })

  test('leave a name that already carries an extension alone', () => {
    expect(formatLink({ name: 'paper.pdf' }, 'shortest')).toBe('[paper.pdf](paper.pdf)')
  })
})

describe('the setting itself', () => {
  test('refuses anything that is not one of the four', () => {
    expect(isLinkFormat('wikilink')).toBe(true)
    expect(isLinkFormat('sideways')).toBe(false)
    expect(isLinkFormat(null)).toBe(false)
  })

  test('is what every writer in the app uses without being told', () => {
    expect(linkWriting()).toBe('wikilink')
    setLinkWriting('absolute')
    try {
      expect(linkTo('Plan', null, { path: 'ideas/Plan.md' })).toBe('[Plan](ideas/Plan.md)')
      expect(citation('paper.pdf', 3, '')).toBe('[paper.pdf](paper.pdf#page=3)\n')
    } finally {
      setLinkWriting('wikilink')
    }
  })
})

/** Every writer goes through `linkTo`, so the setting is answered once. These are
 *  the writers, each with the setting on. */
describe('every writer in the app', () => {
  test('writes what the setting asks for, and a wikilink by default', () => {
    expect(linkTo('Plan')).toBe('[[Plan]]')
    expect(citation('paper.pdf', 3, '')).toBe('[[paper.pdf#page=3]]\n')

    const quoted = citation('paper.pdf', 12, 'A claim.')
    expect(quoted).toBe('> A claim.\n\n[[paper.pdf#page=12]]\n')
  })

  test('includes the block link a Copy link puts on the clipboard', () => {
    expect(linkTo('Plan', null, { fragment: '^a1b2c3', path: 'Plan.md', from: 'Plan.md' })).toBe(
      '[[Plan#^a1b2c3]]',
    )

    setLinkWriting('relative')
    try {
      expect(linkTo('Plan', null, { fragment: '^a1b2c3', path: 'Plan.md', from: 'Plan.md' })).toBe(
        '[Plan](Plan.md#^a1b2c3)',
      )
    } finally {
      setLinkWriting('wikilink')
    }
  })

  test('includes the links an import rewrites', () => {
    const find = (target: string) =>
      target === 'old/Plan.md' ? { path: 'ideas/Plan.md', name: 'Plan' } : null
    const at = { was: 'old/Monday.md', now: 'journal/Monday.md' }

    expect(rewriteLinks('see [the plan](old/Plan.md)', at, find)).toBe('see [[Plan|the plan]]')
    expect(rewriteLinks('see [[old/Plan.md]]', at, find)).toBe('see [[Plan]]')

    setLinkWriting('relative')
    try {
      expect(rewriteLinks('see [the plan](old/Plan.md)', at, find)).toBe(
        'see [the plan](../ideas/Plan.md)',
      )
      expect(rewriteLinks('see [[old/Plan.md]]', at, find)).toBe('see [Plan](../ideas/Plan.md)')
    } finally {
      setLinkWriting('wikilink')
    }
  })
})
