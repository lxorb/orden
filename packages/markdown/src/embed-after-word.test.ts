import { expect, test } from 'vitest'
import { renderMarkdown } from './index'

const drawn = (source: string) => renderMarkdown(source, { resolveEmbed: () => 'Plan words.' })

test('a one-letter word and spaces before an embed keep the embed in its line', () => {
  const html = drawn('X ![[Plan]]\n')
  expect(html).not.toContain('<figure class="embed">')
  expect(html).toContain('<p>X ')
})

test('an indented embed under a paragraph line is still drawn', () => {
  expect(drawn('Today\n  ![[Plan]]\n')).toContain('<figure class="embed">')
})
