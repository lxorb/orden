import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { formatLink, isLinkFormat, LINK_FORMATS, linkWriting, setLinkWriting } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

test('the module stands on its own reaches no app module but the platform', () => {
  const reached = readdirSync(SRC)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .flatMap((name) =>
      [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.[^']*)'/g)].map((found) => found[1]),
    )
    .filter((specifier) => specifier?.startsWith('../'))
  expect([...new Set(reached)]).toEqual(['../../platform/src/api'])
})

describe('the way a link is written', () => {
  test('keeps the format it was set to, a wikilink until then', () => {
    expect(linkWriting()).toBe('wikilink')
    setLinkWriting('relative')
    expect(linkWriting()).toBe('relative')
    setLinkWriting('wikilink')
    expect(LINK_FORMATS.every(isLinkFormat)).toBe(true)
    expect(isLinkFormat('other')).toBe(false)
  })

  test('writes one target in each format', () => {
    const target = { name: 'Plan', path: 'Work/Plan.md', from: 'Home/Today.md' }
    expect(LINK_FORMATS.map((format) => formatLink(target, format))).toEqual([
      '[[Plan]]',
      '[Plan](Plan.md)',
      '[Plan](../Work/Plan.md)',
      '[Plan](Work/Plan.md)',
    ])
    expect(formatLink({ name: 'Plan', embed: true, fragment: 'Goals' }, 'wikilink')).toBe('![[Plan#Goals]]')
  })
})
