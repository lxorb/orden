import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { armed, fallen, LEAST_REACH, MOST_REACH, reachFor, risen } from '../src/pull'
import { inSight } from '../src/sight'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
test('the module stands on its own loads only which page note each tab shows, and the rest through doors', () => {
  const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
  const loaded = [...api.matchAll(/^(?:import|export) \{[^}]*\} from '([^']+)'/gm)].map((one) => one[1])
  expect(loaded).toEqual(['./showing.svelte'])
  for (const door of ['loadPages', 'loadNavigator', 'pagesOut', 'pdfTabs']) {
    expect(api).toMatch(new RegExp(`export const ${door} = \\(\\) =>`))
  }
})
describe('the pages in sight', () => {
  const sheets = [0, 1, 2, 3].map((at) => ({ y: at * 1000, height: 900 }))
  test('are the ones the camera reaches, and a screen beyond', () => {
    expect(inSight(sheets, { x: 0, y: 1450, scale: 1 }, 800, 0)).toEqual({ from: 1, to: 2 })
    expect(inSight(sheets, { x: 0, y: 1450, scale: 1 }, 800)).toEqual({ from: 0, to: 3 })
  })
  test('are none when the camera is past them all', () => {
    expect(inSight(sheets, { x: 0, y: 99_000, scale: 1 }, 800)).toEqual({ from: 0, to: 0 })
  })
})
describe('a pull past the last page', () => {
  test('asks for a reach between its bounds', () => {
    expect(reachFor(30)).toBe(LEAST_REACH)
    expect(reachFor(3000)).toBe(MOST_REACH)
  })
  test('gives less the further it goes, and arms once it is past the reach', () => {
    expect(risen(-5, 100)).toBe(0)
    expect(risen(100, 100)).toBeLessThan(100)
    expect(risen(100, 100, true)).toBe(100)
    expect(armed(risen(1000, 100), 100)).toBe(true)
  })
  test('falls back to nothing once let go', () => {
    expect(fallen(80, 0)).toBe(80)
    expect(fallen(80, 1000)).toBe(0)
  })
})
