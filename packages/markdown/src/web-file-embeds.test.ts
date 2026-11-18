import { expect, test } from 'vitest'
import { renderMarkdown } from './index'

test('a web link file embedded in a note is drawn as a link, not its raw shortcut lines', () => {
  const html = renderMarkdown('![[Recipe.url]]\n', {
    resolveEmbed: () => '[InternetShortcut]\nURL=https://example.com/\n',
    resolveLink: () => ({ href: '/space/Recipe.url' }),
  })
  expect(html).not.toContain('InternetShortcut')
  expect(html).toContain('Recipe')
})
