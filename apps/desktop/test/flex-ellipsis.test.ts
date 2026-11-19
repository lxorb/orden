import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SOURCE, svelte, walk } from './files'

describe('an ellipsis', () => {
  test('is asked of the words, never of a flex box whose words it cannot reach', () => {
    const wrong: string[] = []
    for (const path of walk(SOURCE, svelte)) {
      const style = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
      for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = rule[2] ?? ''
        if (!/display:\s*(?:inline-)?flex/.test(body) || !/text-overflow:\s*ellipsis/.test(body)) continue
        const where = `${relative(SOURCE, path).replace(/\\/g, '/')} ${(rule[1] ?? '').trim()}`
        wrong.push(where)
      }
    }
    expect(wrong).toEqual([])
  })
})
