import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A reader who asks their system for as little movement as possible is
 *  answered in one place: every `--dur-*` token goes to zero, and every
 *  duration a component hands a Svelte transition goes through `dur`; see
 *  src/lib/motion.ts. A bare number there is a transition that keeps moving
 *  whatever the setting says, and one of twenty is enough to make the app feel
 *  as though the setting did not take.
 *
 *  The Even Realities plugin is a page and a build of its own, with a surface
 *  drawn for the glasses rather than for this window; see docs/even.md. */

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

/** Every `duration:` and what it was given. */
const DURATION = /duration:\s*([^,}\n]+)/g

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
        if (value.startsWith('dur(')) continue

        const line = one.text.slice(0, match.index).split('\n').length
        offenders.push(`${one.name}:${line}: duration: ${value}`)
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  test('and every file that hands one out says where the rule lives', () => {
    const missing = sources
      .filter(
        (one) => /duration:\s*dur\(/.test(one.text) && !/from '\.\.?\/*motion'/.test(one.text),
      )
      .map((one) => one.name)

    expect(missing).toEqual([])
  })
})
