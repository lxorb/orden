import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

const MOST_SECONDS = 15

function components(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) components(path, found)
    else if (entry.name.endsWith('.svelte')) found.push(path)
  }
  return found
}

test('every component compiles in seconds, not a minute', () => {
  const slow: string[] = []
  for (const path of components(SOURCE)) {
    const started = performance.now()
    compile(readFileSync(path, 'utf8'), { filename: path, generate: 'client' })
    const seconds = (performance.now() - started) / 1000
    if (seconds > MOST_SECONDS) slow.push(`${path.slice(SOURCE.length)}: ${seconds.toFixed(1)} s`)
  }
  expect(slow).toEqual([])
}, 300_000)
