import { describe, expect, test } from 'vitest'
import { changesBetween, type Replacement, written } from './written'

function applied(text: string, changes: readonly Replacement[]): string {
  return [...changes]
    .sort((one, other) => other.from - one.from)
    .reduce((out, one) => out.slice(0, one.from) + one.insert + out.slice(one.to), text)
}

const text = (runs: readonly (readonly string[])[]) => written(runs).text

describe('what changed between two writes of a plane', () => {
  const head = ['{\n']
  const ink = ['a', ',', 'b', ',', 'c']
  const tail = ['\n}\n']

  test('is nothing at all where nothing did', () => {
    expect(changesBetween(written([head, ink, tail]), [head, [...ink], tail])).toEqual([])
  })

  test('is the one piece a stroke drawn adds, and nothing before it', () => {
    const after = [head, [...ink, ',', 'd'], tail]
    const changes = changesBetween(written([head, ink, tail]), after) ?? []

    expect(changes).toEqual([{ from: 7, to: 7, insert: ',d' }])
    expect(applied(text([head, ink, tail]), changes)).toBe(text(after))
  })

  test('is the piece taken out of the middle, where one is rubbed out', () => {
    const after = [head, ['a', ',', 'c'], tail]
    const changes = changesBetween(written([head, ink, tail]), after) ?? []

    expect(changes.reduce((sum, one) => sum + one.to - one.from, 0)).toBe(2)
    expect(applied(text([head, ink, tail]), changes)).toBe(text(after))
  })

  test('is one replacement per run that moved, however far apart they are', () => {
    const times = ['"a": 1\n', '"b": 1\n', '"c": 1']
    const after = [head, [...ink, ',', 'd'], ['"a": 1\n', '"b": 1\n', '"c": 1\n', '"d": 2'], tail]
    const changes = changesBetween(written([head, ink, times, tail]), after) ?? []

    expect(changes).toHaveLength(2)
    expect(applied(text([head, ink, times, tail]), changes)).toBe(text(after))
  })

  test('is not worked out for two files laid out differently', () => {
    expect(changesBetween(written([head, tail]), [head, ink, tail])).toBeNull()
  })

  const listed = (ids: readonly number[]) =>
    ids.flatMap((id, at) =>
      at ? [',\n\t\t\t', `{"id": "s${String(id)}"}`] : [`{"id": "s${String(id)}"}`],
    )
  const strokes = (count: number) => listed(Array.from({ length: count }, (_, at) => at))

  test('is a small piece for each stroke rubbed out, however far apart they lie', () => {
    const ink = strokes(1000)
    const kept = Array.from({ length: 1000 }, (_, at) => at).filter((at) => at !== 3 && at !== 990)
    const after = [head, listed(kept), tail]
    const changes = changesBetween(written([head, ink, tail]), after) ?? []

    expect(changes).toHaveLength(2)
    expect(changes.every((one) => one.to - one.from < 20 && one.insert === '')).toBe(true)
    expect(applied(text([head, ink, tail]), changes)).toBe(text(after))
  })

  test('is a small piece for each stroke cut in two, however far apart they lie', () => {
    const ink = strokes(1000)
    const cut = ink.flatMap((one) =>
      one === '{"id": "s5"}' || one === '{"id": "s700"}' ? [one, ',\n\t\t\t', `${one}b`] : [one],
    )
    const changes = changesBetween(written([head, ink, tail]), [head, cut, tail]) ?? []

    expect(changes).toHaveLength(2)
    expect(changes.reduce((sum, one) => sum + one.insert.length, 0)).toBeLessThan(60)
    expect(applied(text([head, ink, tail]), changes)).toBe(text([head, cut, tail]))
  })

  test('carries nothing but the strokes rubbed out, however many and wherever they lie', () => {
    let seed = 5
    const random = (below: number) => {
      seed = (seed * 16807) % 2147483647
      return seed % below
    }
    const all = Array.from({ length: 400 }, (_, at) => at)

    for (let round = 0; round < 50; round++) {
      const gone = new Set(Array.from({ length: 1 + random(30) }, () => random(400)))
      const after = [head, listed(all.filter((at) => !gone.has(at))), tail]
      const changes = changesBetween(written([head, listed(all), tail]), after) ?? []

      expect(changes.length).toBeLessThanOrEqual(gone.size)
      expect(changes.every((one) => one.insert === '')).toBe(true)
      expect(applied(text([head, listed(all), tail]), changes)).toBe(text(after))
    }
  })

  test('always writes what the plane now is, whatever was moved, taken or added', () => {
    let seed = 11
    const random = (below: number) => {
      seed = (seed * 16807) % 2147483647
      return seed % below
    }
    const words = ['a', 'b', 'c', ',', ',\n', 'dd', '']

    for (let round = 0; round < 400; round++) {
      const was = Array.from({ length: random(12) }, () => words[random(words.length)] ?? '')
      const now = [...was]
      for (let edit = random(6); edit > 0; edit--) {
        const where = random(now.length + 1)
        if (random(2)) now.splice(where, 1)
        else now.splice(where, 0, words[random(words.length)] ?? '')
      }
      const changes = changesBetween(written([head, was, tail]), [head, now, tail]) ?? []

      expect(applied(text([head, was, tail]), changes)).toBe(text([head, now, tail]))
      expect(changes.every((one, at) => at === 0 || (changes[at - 1]?.to ?? 0) <= one.from)).toBe(
        true,
      )
    }
  })
})
