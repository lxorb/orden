import { renderMarkdown } from '@nib/markdown'
import { expect, test } from 'vitest'
import { plain } from './inline'

/** Lines of letters, blanks, backslashes and backticks, drawn by the view and by the
 *  renderer: the same words, whatever the backslashes and the backticks make of it. */
const ALPHABET = ['a', 'b', ' ', '\\', '`']

/** A seeded run, so a failure is the same failure again. */
function lines(count: number): string[] {
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
  return Array.from({ length: count }, () =>
    Array.from({ length: 4 + (next() % 12) }, () => ALPHABET[next() % ALPHABET.length]).join(''),
  ).filter((line) => !line.includes('``') && /^[ab]/.test(line) && /[ab]$/.test(line))
}

const said = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

test('a task line says what the renderer says, backticks and backslashes and all', () => {
  const tried = lines(4000)
  expect(tried.length).toBeGreaterThan(200)
  for (const line of tried) {
    expect([line, plain(line).replace(/\s+/g, ' ').trim()]).toEqual([
      line,
      said(renderMarkdown(line)),
    ])
  }
})
