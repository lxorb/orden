import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found)
    } else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) {
      found.push(path)
    }
  }
  return found
}

const sources = sourceFiles(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

const DOORS = [
  { what: 'a link with download on it', pattern: /\bdownload=\{/ },
  { what: 'a link clicked in script', pattern: /\.download\s*=(?!=)/ },
  {
    what: 'the save dialog',
    pattern: /\{\s*save\s*\}\s*=\s*await import\('@tauri-apps\/plugin-dialog'\)/,
  },
]

describe('every file the app hands out', () => {
  test.each(DOORS)('through $what is seen going', ({ pattern }) => {
    const through = sources.filter((one) => pattern.test(one.text))
    expect(through.length).toBeGreaterThan(0)

    const silent = through
      .filter((one) => !/\bdownloadStarted\(/.test(one.text))
      .map((one) => one.name)
    expect(silent).toEqual([])
  })

  test("and a web tab's page says it as each download starts", () => {
    const store = sources.find((one) => one.name === 'lib/web-tab/src/downloads.svelte.ts')
    expect(store?.text).toMatch(/downloadStarted\(one\.name, \{ tab: one\.tab \}\)/)
  })
})
