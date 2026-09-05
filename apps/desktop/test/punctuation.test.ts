import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// `.claude` holds tooling state, including whole copies of this repo checked
// out for an agent to work in, which would otherwise be read as second copies
// of every file here.
const SKIP = new Set(['node_modules', 'dist', 'target', '.git', '.svelte-kit', 'gen', '.claude'])
const EXTENSIONS = ['.ts', '.svelte', '.rs', '.css', '.json', '.jsonc', '.md', '.mjs', '.yml']

/** Smart punctuation turns what someone types into an em dash. That is their
 *  document, not the app's own words, so it is the one place they belong. */
const ALLOWED = ['packages/editor/src/typography.ts', 'packages/editor/src/typography.test.ts']

/** Built from its code point so this file is not its own first offender. */
const EM_DASH = String.fromCharCode(0x2014)

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue

    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (EXTENSIONS.some((extension) => name.endsWith(extension))) found.push(path)
  }

  return found
}

describe('the app writes without em dashes', () => {
  test('nothing outside smart punctuation uses one', () => {
    const offenders: string[] = []

    for (const path of sources(ROOT)) {
      const relative = path.slice(ROOT.length).replace(/\\/g, '/')
      if (ALLOWED.includes(relative)) continue

      const text = readFileSync(path, 'utf8')
      if (text.includes(EM_DASH)) {
        const line = text.split('\n').findIndex((one: string) => one.includes(EM_DASH)) + 1
        offenders.push(`${relative}:${line}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
