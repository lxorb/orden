import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const EDITOR = fileURLToPath(new URL('../../../packages/editor/src/', import.meta.url))

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) found.push(path)
  }

  return found
}

const files = sources(EDITOR).map((path) => ({
  name: path.slice(EDITOR.length).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

describe('the editor package', () => {
  test('was found', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('installs a keymap of plain bindings in one place only', () => {
    const installers = files.filter((one) => one.text.includes('keymap.of(')).map((one) => one.name)

    expect(installers).toEqual(['completing.ts', 'editor.ts'])
  })

  test('name the search engine in one module only', () => {
    const named = files
      .filter((one) => one.text.includes("from '@codemirror/search'"))
      .map((one) => one.name)

    expect(named).toEqual(['finding.ts'])
  })

  test('builds every other keymap from bindings that have a name', () => {
    const named = files.filter((one) => one.text.includes('boundKeymap(')).map((one) => one.name)

    expect(named.sort()).toEqual(['editor.ts', 'live-preview/image/index.ts', 'shortcuts.ts'])
  })
})

const APP = fileURLToPath(new URL('../src/', import.meta.url))

function markup(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) markup(path, found)
    else if ((name.endsWith('.ts') || name.endsWith('.svelte')) && !name.endsWith('.test.ts'))
      found.push(path)
  }
  return found
}

describe('the menus and the palette', () => {
  test('never spell a shortcut out by hand', () => {
    const guilty = markup(APP)
      .map((path) => ({
        name: path.slice(APP.length).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
      }))
      .filter((one) => /hint: '(?:Ctrl|Cmd|Alt|Shift|Mod|Meta|Option)[+-][^' ]*'/.test(one.text))
      .map((one) => one.name)

    expect(guilty).toEqual([])
  })
})
