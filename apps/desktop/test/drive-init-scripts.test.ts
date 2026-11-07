import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { expect, test } from 'vitest'

const HARNESS = readFileSync(join(import.meta.dirname, 'e2e/harness.py'), 'utf8')

function scriptsPutIntoPages(source: string): Map<string, string> {
  const names = new Set([...source.matchAll(/add_init_script\(([A-Z_]+)\)/g)].map((one) => one[1]))
  const out = new Map<string, string>()
  for (const name of names) {
    if (!name) continue
    const held = new RegExp(String.raw`^${name} = \(\n([\s\S]*?)\n\)`, 'm').exec(source)
    if (!held?.[1]) throw new Error(`${name} is not written as strings in brackets`)
    const parts = [...held[1].matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*$/gm)].map((one) =>
      (one[1] ?? '').replace(/\\(["\\])/g, '$1'),
    )
    out.set(name, parts.join(''))
  }
  return out
}

test('every script the drives put into a page is JavaScript that parses', () => {
  const scripts = scriptsPutIntoPages(HARNESS)
  expect([...scripts.keys()]).toContain('BUILT_IN')
  for (const [name, code] of scripts) {
    expect(() => new Script(code), name).not.toThrow()
  }
})

test('a script missing a semicolon between two statements is caught', () => {
  const broken = 'BUILT_IN = (\n    "a()"\n    " if (b) c()"\n)\nx.add_init_script(BUILT_IN)\n'
  const code = scriptsPutIntoPages(broken).get('BUILT_IN') ?? ''
  expect(() => new Script(code)).toThrow()
})
