import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))
const SHEET = fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

test('every field reads each line in the direction of its words, its placeholder in the app’s', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  expect(sheet).toMatch(/textarea,\s*input:is\([\s\S]*?\)\s*\{\s*unicode-bidi:\s*plaintext;/)

  const fixed = svelteFiles(SOURCE).filter((path) =>
    /<(?:textarea|input)\b[^>]*\bdir="auto"/.test(readFileSync(path, 'utf8')),
  )
  expect(fixed).toEqual([])
})

test('a name alone in its label is laid out in its own direction, so a cut-off keeps its start', () => {
  const alone =
    /<(span|p|div|strong)\b(?:[^>{]|\{[^}]*\})*>\s*<bdi>\{[^<]*\}<\/bdi\s*>\s*<\/\1\s*>/g
  const isolated = svelteFiles(SOURCE).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(alone)].map(
      (one) => `${path.slice(SOURCE.length)}: ${one[0].replace(/\s+/g, ' ')}`,
    ),
  )
  expect(isolated).toEqual([])
})

test('no name sits in a bare bdi, whose clipped label would keep the app’s direction and cut its start', () => {
  const bare = svelteFiles(SOURCE).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/<bdi\s*>/g)].map(() => path.slice(SOURCE.length)),
  )
  expect(bare).toEqual([])
})

test('a label aligned with its row says so in a way Chromium reads too', () => {
  const sheets = [SHEET, ...svelteFiles(SOURCE)]
  const lone = sheets.flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, at, lines) =>
        /text-align:\s*match-parent/.test(line) &&
        !/text-align:\s*-webkit-match-parent/.test(lines[at - 1] ?? '')
          ? [`${path}:${at + 1}`]
          : [],
      ),
  )
  expect(lone).toEqual([])
})

test('a box laid out in its name’s direction carries no gap or flow of its own that would turn with it', () => {
  const turned = svelteFiles(SOURCE).flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    const style = text.slice(text.indexOf('<style'))
    return [
      ...text.matchAll(
        /<(?!input|textarea)\w+\b((?:[^>{]|\{[^}]*\})*?\bdir="auto"(?:[^>{]|\{[^}]*\})*)>/g,
      ),
    ]
      .flatMap((tag) =>
        (/class="([^"]*)"/.exec(tag[1] ?? '')?.[1] ?? '').split(/\s+/).filter(Boolean),
      )
      .filter((name) => {
        const own = [...style.matchAll(/([^{}]*)\{([^}]*)\}/g)]
          .map(([, selector = '', body = '']) => ({ selector, body }))
          .filter(({ selector }) =>
            selector
              .split(/,(?![^(]*\))/)
              .some((one) => new RegExp(`\\.${name}(?![\\w-])[^\\s>+~]*$`).test(one.trim())),
          )
        const swapped = own.some(
          ({ selector, body }) =>
            selector.includes(`.${name}:dir(`) && /(?:margin|padding)-inline/.test(body),
        )
        return own.some(
          ({ body }) =>
            /display:\s*(?:inline-)?(?:flex|grid)/.test(body) ||
            (!swapped && /(?:margin|padding)-inline|inset-inline/.test(body)),
        )
      })
      .map((name) => `${path.slice(SOURCE.length)}: .${name}`)
  })
  expect(turned).toEqual([])
})

test('a code, key or address is laid out left to right, so its groups keep their order in right-to-left', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  expect(sheet).toMatch(
    /input:is\(\s*\[type='email'\],\s*\[type='url'\],\s*\[type='tel'\],\s*\[inputmode='numeric'\],\s*\[autocomplete='one-time-code'\]\s*\)\s*\{\s*direction:\s*ltr;/,
  )
  const places = [
    ...svelteFiles(join(SOURCE, 'lib', 'pass-ui', 'src')),
    join(SOURCE, 'lib', 'ui-controls', 'src', 'Copyable.svelte'),
    ...['Security', 'SignIn'].map((name) => join(SOURCE, 'lib/accounts-ui/src', `${name}.svelte`)),
  ]
  const turned = places.flatMap((path) =>
    [
      ...readFileSync(path, 'utf8').matchAll(
        /<(?:output|code)\b[^>]*>|<\w+\b[^>]*class="(?:digits|codes)"[^>]*>/g,
      ),
    ]
      .filter((tag) => !tag[0].includes('dir="ltr"'))
      .map((tag) => `${path.slice(SOURCE.length)}: ${tag[0]}`),
  )
  expect(turned).toEqual([])
})
