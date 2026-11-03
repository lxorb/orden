import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every way the app hands a file out is seen going (#1048): it says so through
 *  `downloadStarted` (src/lib/downloads/started.ts), which flies the file to the
 *  downloads glyph and says it through the live region. A web tab's page says it in
 *  downloads.svelte.ts; the app's own files leave by one of three doors, and each of
 *  them is held here, so a fourth written tomorrow cannot leave silently:
 *
 *  - a link with `download` on it, which the reader presses (a chat's attachment);
 *  - a link made in script and clicked (`.download = ` - a file handed to a browser);
 *  - the system's save dialog, a place chosen for an export. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, found)
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
    const store = sources.find((one) => one.name === 'lib/web-tab/downloads.svelte.ts')
    expect(store?.text).toMatch(/downloadStarted\(one\.name, \{ tab: one\.tab \}\)/)
  })
})
