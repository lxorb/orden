import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

const NOT_YET = new Set(['lib/Sheet.svelte .sheet :global(.name)'])

function views(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

describe('an ellipsis', () => {
  test('is asked of the words, never of a flex box whose words it cannot reach', () => {
    const wrong: string[] = []
    for (const path of views()) {
      const style = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
      for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = rule[2] ?? ''
        if (!/display:\s*(?:inline-)?flex/.test(body) || !/text-overflow:\s*ellipsis/.test(body))
          continue
        const where = `${relative(SOURCE, path).replace(/\\/g, '/')} ${(rule[1] ?? '').trim()}`
        if (!NOT_YET.has(where)) wrong.push(where)
      }
    }
    expect(wrong).toEqual([])
  })
})
