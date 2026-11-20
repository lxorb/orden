import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ROOT, SOURCE, walk } from './files'

const THEMES = join(ROOT, 'packages/themes/src')
const PARTED = new Set([' ', '>', '+', '~'])
function split(text: string, at: (char: string) => boolean): string[] {
  const parts: string[] = []
  let depth = 0
  let part = ''
  for (const char of text) {
    if (char === '(' || char === '[') depth++
    if (char === ')' || char === ']') depth--
    if (depth === 0 && at(char)) {
      parts.push(part)
      part = ''
    } else part += char
  }
  return [...parts, part].map((one) => one.trim()).filter(Boolean)
}
function pseudos(compound: string): { name: string; args: string | null }[] {
  const found: { name: string; args: string | null }[] = []
  const reading = /::?([\w-]+)/g
  for (let match = reading.exec(compound); match; match = reading.exec(compound)) {
    const after = match.index + match[0].length
    if (compound[after] !== '(') {
      found.push({ name: match[1] ?? '', args: null })
      continue
    }
    let depth = 0
    let end = after
    for (; end < compound.length; end++) {
      if (compound[end] === '(') depth++
      if (compound[end] === ')' && --depth === 0) break
    }
    found.push({ name: match[1] ?? '', args: compound.slice(after + 1, end) })
    reading.lastIndex = end + 1
  }
  return found
}
function bare(compound: string): string {
  let out = ''
  let depth = 0
  for (let at = 0; at < compound.length; at++) {
    const char = compound[at] ?? ''
    if (depth === 0 && char === ':') {
      const rest = /^::?[\w-]+/.exec(compound.slice(at))?.[0] ?? ':'
      at += rest.length - 1
      if (compound[at + 1] === '(') {
        depth = 0
        for (at++; at < compound.length; at++) {
          if (compound[at] === '(') depth++
          if (compound[at] === ')' && --depth === 0) break
        }
      }
      continue
    }
    out += char
  }
  return out.replace(/\*/g, '').trim()
}
function compoundsOf(selector: string): string[] {
  return split(selector.replace(/\s*([>+~])\s*/g, '$1'), (char) => PARTED.has(char))
}
function narrowed(compound: string): boolean {
  if (bare(compound)) return true
  return pseudos(compound).some(
    (one) =>
      (one.name === 'is' || one.name === 'where') &&
      one.args !== null &&
      split(one.args, (char) => char === ',').every((alternative) => narrowed(compoundsOf(alternative).at(-1) ?? '')),
  )
}
function loose(selector: string, held = false): boolean {
  return split(selector, (char) => char === ',').some((one) => {
    const compounds = compoundsOf(one)
    return compounds.some((compound, at) => {
      const inner = pseudos(compound)
      const named = narrowed(compound) || (held && at === compounds.length - 1)
      if (inner.some((pseudo) => pseudo.name === 'has') && !named) return true
      return inner.some((pseudo) => pseudo.args !== null && pseudo.name !== 'has' && loose(pseudo.args, named))
    })
  })
}
function selectorsOf(css: string): string[] {
  const said = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:global\(/g, ':is(')
    .replace(/:global\s+/g, '')
  return [...said.matchAll(/([^{}]+)\{/g)]
    .map((one) => (one[1] ?? '').trim())
    .filter((one) => one && !one.startsWith('@') && !/^(from|to|\d+%)/.test(one))
}
function looseIn(files: string[]): string[] {
  return files.flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    const css = path.endsWith('.svelte')
      ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1] ?? '').join('\n')
      : text
    return selectorsOf(css)
      .filter((one) => loose(one))
      .map((one) => `${relative(ROOT, path).replace(/\\/g, '/')}: ${one.replace(/\s+/g, ' ')}`)
  })
}
const STILL_LOOSE = [
  'packages/themes/src/base.css: :has(> .orden-mark)',
  'apps/desktop/src/lib/foreign/src/ForeignMark.svelte: :is(:is(.orden-row-label, :has(+ .orden-row-label)):has(~ .foreign))',
]
describe('a :has() rule', () => {
  test('is told apart when nothing but the :has() says which element it styles', () => {
    expect(loose(':has(> .orden-mark)')).toBe(true)
    expect(loose('[data-touch] :has(> .x)')).toBe(true)
    expect(loose(':is(.a, :has(+ .b)):has(~ .c)')).toBe(true)
    expect(loose(':not(:has(.x))')).toBe(true)
    expect(loose('.orden-field:has(:is(input, textarea):focus)')).toBe(false)
    expect(loose('label:has(> input[type="checkbox"])')).toBe(false)
    expect(loose('#write.preview:not(:has(*))')).toBe(false)
    expect(loose(':is(.a, .b):has(> .c)')).toBe(false)
    expect(loose('.a :is(.b, .c)')).toBe(false)
  })
  test('in the app and its themes names the element it styles, and the few that do not yet only ever go away', () => {
    const found = looseIn([
      ...walk(THEMES, (path) => path.endsWith('.css')),
      ...walk(SOURCE, (path) => /\.(css|svelte)$/.test(path), ['node_modules']),
    ])
    expect(found.filter((one) => !STILL_LOOSE.includes(one))).toEqual([])
    expect(STILL_LOOSE.filter((one) => !found.includes(one))).toEqual([])
  })
})
