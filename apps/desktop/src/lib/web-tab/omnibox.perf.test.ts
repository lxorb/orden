import { expect, test } from 'vitest'
import { completion, suggested } from './omnibox'
import { MOST_VISITS, type Visit } from './visits'

const CLOCKED = process.env.NIB_PERF === '1'

const NOW = Date.UTC(2026, 8, 27)

const full: Visit[] = Array.from({ length: MOST_VISITS }, (_, index) => ({
  url: `https://site${String(index)}.example.com/section/${String(index)}/page?id=${String(index)}`,
  title: `Page number ${String(index)} of a site somebody reads`,
  visits: 1 + (index % 7),
  typed: index % 3,
  last: NOW - index * 60_000,
}))

test('a keystroke with the history full is a frame at most', () => {
  const address = 'site499.example.com/section/4'
  const started = performance.now()

  for (let length = 1; length <= address.length; length++) {
    const typed = address.slice(0, length)
    completion(full, typed, NOW)
    suggested(full, typed, NOW)
  }

  const each = (performance.now() - started) / address.length

  expect(completion(full, address, NOW)?.url).toBe(
    'https://site499.example.com/section/499/page?id=499',
  )
  if (CLOCKED) expect(each).toBeLessThan(16)
})
