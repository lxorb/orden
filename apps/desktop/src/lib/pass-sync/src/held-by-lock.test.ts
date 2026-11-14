import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../..', import.meta.url))
const PASS = ['pass-sync', 'pass-ui', 'pass-links'].map((one) => join(LIB, one, 'src'))
const ASKS = /\b(?:prompt\.(?:ask|confirm|choose|chooseTicking|find)|menu\.show)\(/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(?:svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

function call(text: string, from: number): string {
  let depth = 1
  for (let at = from; at < text.length; at++) {
    if (text[at] === '(') depth++
    else if (text[at] === ')' && --depth === 0) return text.slice(from, at)
  }
  return text.slice(from)
}

describe('a question or menu Pass opens', () => {
  test('is held by the lock, so locking takes it away', () => {
    const loose: string[] = []
    for (const path of PASS.flatMap(sources)) {
      const text = readFileSync(path, 'utf8')
      for (const found of text.matchAll(ASKS)) {
        if (/\buntil: pass\.opened\b/.test(call(text, found.index + found[0].length))) continue
        const line = text.slice(0, found.index).split('\n').length
        loose.push(`${relative(LIB, path).replace(/\\/g, '/')}:${line}`)
      }
    }
    expect(loose).toEqual([])
  })
})
