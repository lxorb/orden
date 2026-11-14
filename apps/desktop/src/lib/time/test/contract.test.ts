import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  loadTimePanel,
  loadTimeTab,
  openTime,
  startTimer,
  stopTimer,
  trackingMenu,
  wakeTime,
} from '../src/api'
import type { Span } from '../src/records'
import { csvOf, jsonOf, recordsIn } from '../src/written'
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads and every call is there', () => {
    for (const one of [
      loadTimePanel,
      loadTimeTab,
      openTime,
      startTimer,
      stopTimer,
      trackingMenu,
      wakeTime,
    ]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('what the time is written out as', () => {
  const span: Span = {
    id: 's',
    start: Date.UTC(2026, 10, 5, 9),
    end: Date.UTC(2026, 10, 5, 10, 30),
    activity: 'uni',
    tags: [],
    note: '=SUM(A1)',
    source: 'timer',
    place: null,
    label: null,
    device: null,
  }
  const uni = { id: 'uni', name: 'Uni', tint: null, parent: null, archived: false, order: 1 }

  test('a spreadsheet row a span, its length in minutes, and no formula a note starts with', () => {
    const [head, row] = csvOf([span], [uni], 0).split('\r\n')
    expect(head).toBe('start,end,minutes,activity,tags,note,source,place')
    expect(row).toBe("2026-11-05T09:00:00.000Z,2026-11-05T10:30:00.000Z,90,Uni,,'=SUM(A1),timer,")
  })

  test('the records come back from their own file and from nothing else', () => {
    const records = [{ kind: 'span', id: 'a1', value: { start: 1 } }]
    expect(recordsIn(jsonOf(records))).toEqual(records)
    expect(recordsIn('{"format":"other","records":[]}')).toBeNull()
    expect(recordsIn('not json')).toBeNull()
    expect(recordsIn(jsonOf([{ kind: 'Span!', id: 'a1', value: {} }]))).toEqual([])
  })
})
