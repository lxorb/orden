import { describe, expect, test } from 'vitest'
import { backpedal } from './backpedal'
import { escapeText } from './escapes'
import { renderMarkdown } from './index'

const MARKED = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/

function asMarked(address: string): string {
  for (let before = ''; before !== address;) {
    before = address
    address = MARKED.exec(address)?.[0] ?? ''
  }
  return address
}

const PIECES = [
  'a',
  'b1',
  '/',
  '(',
  ')',
  '&',
  'amp',
  ';',
  '.',
  ',',
  '?',
  '!',
  ':',
  '*',
  '_',
  "'",
  '"',
  '~',
  '-',
  '#',
  'é',
]

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
}

const quick = (run: () => unknown) => {
  const started = performance.now()
  run()
  expect(performance.now() - started).toBeLessThan(1500)
}

describe('the end of a bare address', () => {
  test('is cut where marked cuts it', () => {
    const random = seeded(11)
    for (let round = 0; round < 200_000; round++) {
      let address = round % 3 === 0 ? 'https://a.b/' : round % 3 === 1 ? '' : '('
      const pieces = 1 + Math.floor(random() * 14)
      for (let at = 0; at < pieces; at++)
        address += PIECES[Math.floor(random() * PIECES.length)] ?? ''
      expect(backpedal(address), address).toBe(asMarked(address))
    }
  }, 60_000)

  test('is cut in time that grows with its length', () => {
    const units = ['.,', ')', '*_', '&a;', '&a;.', '(', '((x)', 'x)', '.(', ';&', '&amp;)', "'"]
    for (const unit of units) {
      const address = `https://a.b/${unit.repeat(Math.ceil(60_000 / unit.length))}`
      quick(() => backpedal(address))
      quick(() => renderMarkdown(`see ${address} here`))
      quick(() => escapeText(`see ${address} here`, { addresses: true }))
    }
  }, 60_000)
})
