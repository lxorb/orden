// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { answerHtml } from './drawn'

function pressHeld(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector<HTMLElement>('[data-picture]')?.dataset.picture ?? ''
}
function shownAfterPress(markdown: string): string {
  const shown = new Set<string>()
  shown.add(pressHeld(answerHtml(markdown, { from: 'Notes/Plan.md', shown })))
  return answerHtml(markdown, { from: 'Notes/Plan.md', shown })
}
test('a held web picture whose address has a query with & shows once asked', () => {
  const html = shownAfterPress('![chart](https://cdn.example.com/chart.png?w=600&h=400)')
  expect(html).toContain('<img')
  expect(html).not.toContain('picture-held')
})
test('a picture of the note named with & shows at once, from the space', () => {
  const html = answerHtml('![[Q&A board.png]]', { from: 'Notes/Plan.md' })
  expect(html).toContain('<img')
  expect(html).not.toContain('picture-held')
})
test('an address whose colon is written as a named entity never loads from the web', () => {
  const html = answerHtml('<img src="https&colon;//evil.example/x.png" alt="x">', {
    from: 'Notes/Plan.md',
  })
  expect(html).not.toMatch(/<img\b[^>]*src="(?:[a-z]+:|\/\/)/i)
})
