import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const PLUGIN = 'lib/even/'

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

const sources = componentFiles(SOURCE)
  .map((path) => ({
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text: readFileSync(path, 'utf8'),
  }))
  .filter((one) => !one.name.startsWith(PLUGIN))

const DURATION = /duration:\s*([^,}\n]+)/g

const THROUGH_DUR = /^(dur\(|calm\(|LAYER\.(fade|rise)\b)/

describe('the durations JavaScript hands out', () => {
  test('the scan finds them', () => {
    const found = sources.filter((one) => DURATION.test(one.text))
    expect(found.length).toBeGreaterThan(15)
  })

  test('all go through dur, so reduced motion reaches every one', () => {
    const offenders: string[] = []

    for (const one of sources) {
      for (const match of one.text.matchAll(DURATION)) {
        const value = (match[1] ?? '').trim()
        if (THROUGH_DUR.test(value)) continue

        const line = one.text.slice(0, match.index).split('\n').length
        offenders.push(`${one.name}:${line}: duration: ${value}`)
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  test('and every file that hands one out says where the rule lives', () => {
    const missing = sources
      .filter(
        (one) =>
          /duration:\s*(dur\(|LAYER\.)/.test(one.text) &&
          !/from '(?:\.\.?\/)+(?:lib\/)?motion'/.test(one.text),
      )
      .map((one) => one.name)

    expect(missing).toEqual([])
  })
})

describe('the animations that never end', () => {
  const looping = sources.filter((one) => /animation:[^;]*\binfinite\b/.test(one.text))

  test('the scan finds them', () => {
    expect(looping.length).toBeGreaterThan(4)
  })

  test('each stops for a reader who asked for less movement', () => {
    const still = /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*?animation:\s*none/

    const moving = looping.filter((one) => !still.test(one.text)).map((one) => one.name)

    expect(moving).toEqual([])
  })
})
