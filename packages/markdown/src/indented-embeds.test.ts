import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'
import type { Wikilink } from './links'

const NOTES: Record<string, string> = {
  Plan: '# Plan\n\nPlan words.\n\n## Later\n\nLater words.\n',
}

const resolveEmbed = (link: Wikilink) => NOTES[link.target] ?? null

const drawn = (source: string) => renderMarkdown(source, { resolveEmbed })

describe('an embed on a line of its own that Live Preview draws, indented past its column', () => {
  test('in a numbered step after a blank, four spaces in, draws the section', () => {
    const html = drawn('1. Step\n\n    ![[Plan#Later]]\n')
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('Later words.')
  })

  test('in a bullet item after a blank, a tab in, draws the section', () => {
    const html = drawn('- Step\n\n\t![[Plan#Later]]\n')
    expect(html).toContain('<figure class="embed">')
  })

  test('in a bullet item after a blank, four spaces in, draws the section', () => {
    const html = drawn('- Step\n\n    ![[Plan#Later]]\n')
    expect(html).toContain('<figure class="embed">')
  })

  test('outside a list, two or three spaces in, draws the section', () => {
    expect(drawn('  ![[Plan#Later]]\n')).toContain('<figure class="embed">')
    expect(drawn('   ![[Plan#Later]]\n')).toContain('<figure class="embed">')
  })
})
