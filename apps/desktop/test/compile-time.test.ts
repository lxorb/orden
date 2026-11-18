import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'
import { svelte, walk } from './files'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

const MOST_SECONDS = 15

test('every component compiles in seconds, not a minute', () => {
  const slow: string[] = []
  for (const path of walk(SOURCE, svelte)) {
    const started = performance.now()
    compile(readFileSync(path, 'utf8'), { filename: path, generate: 'client' })
    const seconds = (performance.now() - started) / 1000
    if (seconds > MOST_SECONDS) slow.push(`${path.slice(SOURCE.length)}: ${seconds.toFixed(1)} s`)
  }
  expect(slow).toEqual([])
}, 300_000)
