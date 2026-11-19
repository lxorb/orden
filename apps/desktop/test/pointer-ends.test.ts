import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PLACES = ['apps/desktop/src', 'packages']
const sources = () =>
  PLACES.flatMap((place) =>
    readdirSync(join(ROOT, place), { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(?:svelte|ts)$/.test(path) && !/\.test\.ts$|node_modules/.test(path))
      .map((path) => join(place, path)),
  )
const listening = (text: string, type: string) =>
  text.match(new RegExp(`addEventListener\\(\\s*['"]${type}['"]`, 'g'))?.length ?? 0
describe('a press followed through added listeners', () => {
  test('ends on pointercancel wherever it ends on pointerup', () => {
    const loose = sources().flatMap((path) => {
      const text = readFileSync(join(ROOT, path), 'utf8')
      const ups = listening(text, 'pointerup')
      const cancels = listening(text, 'pointercancel')
      return ups > cancels ? [`${path}: ${String(ups)} up, ${String(cancels)} cancel`] : []
    })
    expect(loose).toEqual([])
  })
})
