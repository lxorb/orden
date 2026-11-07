import { expect, test } from 'vitest'
import { growth } from '../../../../../scripts/growth'
import { candidates } from './kinds'
import { LONGEST, MOST, ranked } from './rank'
import { command, file, setting, visit, world } from './world.fixture'

const CLOCKED = process.env.ORDEN_PERF === '1'

const WORDS = ['plan', 'lecture', 'tax', 'notes', 'draft', 'ideas', 'meeting', 'journal']

const BIG = world({
  files: Array.from({ length: 10_000 }, (_, index) =>
    file(`Folder ${String(index % 40)}/${WORDS[index % WORDS.length] ?? ''} ${String(index)}.md`),
  ),
  commands: Array.from({ length: 300 }, (_, index) =>
    command(`c${String(index)}`, `Do the thing number ${String(index)}`),
  ),
  pages: Array.from({ length: 500 }, (_, index) =>
    visit(
      `https://site${String(index)}.example.com/page/${String(index)}`,
      `Page ${String(index)}`,
    ),
  ),
  settings: Array.from({ length: 100 }, (_, index) =>
    setting(`Setting ${String(index)}`, 'Editor', { names: ['word'] }),
  ),
})

function timed(run: () => unknown, times = 5): number {
  const started = performance.now()
  for (let one = 0; one < times; one++) run()
  return (performance.now() - started) / times
}

test('opening builds every candidate once', () => {
  let built = candidates(BIG)
  const each = timed(() => (built = candidates(BIG)), 3)

  expect(built.length).toBe(10_000 + 300 + 500 + 100)
  if (CLOCKED) expect(each).toBeLessThan(150)
})

test('a keystroke scores every candidate once, and lists at most a screenful', () => {
  const all = candidates(BIG)
  const typing = 'lecture 12'
  let longest = 0

  for (let length = 1; length <= typing.length; length++) {
    const term = typing.slice(0, length)
    const each = timed(() => ranked(term, all))
    longest = Math.max(longest, each)
    expect(ranked(term, all).length).toBeLessThanOrEqual(MOST)
  }

  if (CLOCKED) expect(longest).toBeLessThan(60)
})

test('a word nothing has pays for one more pass, not more', () => {
  const all = candidates(BIG)
  const each = timed(() => ranked('qwertz', all))

  expect(ranked('qwertz', all)).toEqual([])
  if (CLOCKED) expect(each).toBeLessThan(120)
})

test('a long paste is weighed by the length a name can have, so each key stays quick', () => {
  const all = candidates(BIG)
  for (const unit of ['lecture 12 ', 'The heron stands still in the shallows. ']) {
    const pasted = unit.repeat(4_000)

    expect(ranked(pasted, all)).toEqual(ranked(pasted.slice(0, LONGEST), all))
    expect(growth((count) => ranked(unit.repeat(count), all), 250, 16)).toBeLessThan(4)
  }
})
