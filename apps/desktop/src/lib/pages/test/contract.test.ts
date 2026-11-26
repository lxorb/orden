import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { began, dragged, FALL, LEAST_REACH, lifted, MOST_REACH, noPull, reachFor, riseOf, wheeled } from '../src/pull'
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
  test('follows the hand one to one up to full, and stays there while held', () => {
    const pull = dragged(began(noPull(), true, 0), { raw: 60, now: 10 })
    expect(riseOf(pull, 100, 10 + FALL * 4)).toBe(60)
    expect(riseOf(dragged(pull, { raw: 400, now: 20 }), 100, 20)).toBe(100)
  })
  test('adds a page only when let go full, never from a wheel alone', () => {
    const filled = wheeled(began(noPull(), true, 0), { delta: 400, now: 10 })
    expect(lifted(filled, { reach: 100, now: 20 }).makes).toBe(true)
    const short = lifted(dragged(began(noPull(), true, 0), { raw: 99, now: 10 }), { reach: 100, now: 20 })
    expect(short.makes).toBe(false)
    expect(riseOf(short.pull, 100, 20 + FALL)).toBe(0)
  })
})
