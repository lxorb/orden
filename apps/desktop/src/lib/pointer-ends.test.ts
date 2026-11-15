import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(?:svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

function listens(text: string, type: string) {
  return (
    text.match(new RegExp(`\\bwindow\\.addEventListener\\(\\s*['"]${type}['"]`, 'g'))?.length ?? 0
  )
}

describe('a drag that follows the pointer through window listeners', () => {
  test('ends on pointercancel as well as on pointerup', () => {
    const loose: string[] = []
    for (const path of sources(SRC)) {
      const text = readFileSync(path, 'utf8')
      const ups = listens(text, 'pointerup')
      const cancels = listens(text, 'pointercancel')
      if (ups > cancels)
        loose.push(`${relative(SRC, path).replace(/\\/g, '/')}: ${ups} up, ${cancels} cancel`)
    }
    expect(loose).toEqual([])
  })
})
