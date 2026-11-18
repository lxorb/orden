import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_DAYS, KEEP_DAYS, SNAPSHOT_MINUTES, staleSnapshots } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('the module stands on its own', () => {
  test('imports nothing at all, so the web backend reads the rules without the recovery store', () => {
    const imports = sources(SRC).flatMap((file) => [
      ...readFileSync(file, 'utf8').matchAll(/^import .* from '([^']+)'/gm),
    ])
    expect(imports.map((found) => found[1])).toEqual([])
  })
})

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('the snapshots kept of a note', () => {
  test('are taken every few minutes and kept for some days', () => {
    expect(SNAPSHOT_MINUTES).toContain(0)
    expect(KEEP_DAYS).toContain(DEFAULT_DAYS)
  })

  test('keep everything from the last day, the newest of each hour before it, nothing too old', () => {
    const now = 100 * DAY
    const recent = now - HOUR
    const older = now - 2 * DAY + HOUR / 2
    const olderSameHour = older - 60 * 1000
    const gone = now - (DEFAULT_DAYS + 1) * DAY
    expect(staleSnapshots([recent, older, olderSameHour, gone], now).sort((a, b) => a - b)).toEqual(
      [gone, olderSameHour],
    )
  })
})
