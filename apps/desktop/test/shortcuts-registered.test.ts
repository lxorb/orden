import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Nothing may install a keymap of its own outside the registry.
 *
 *  A binding built straight from a key and a command is one nobody can find
 *  in the settings and nobody can change, which is the one thing the specs in
 *  packages/editor/src/shortcuts.ts exist to make impossible. The types force
 *  an id on anything declared as a spec; this is what stops a stray
 *  `keymap.of([{ key: 'Mod-j', run }])` appearing beside them. */

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

    // editor.ts holds two of them: Enter closing a code fence, which is fixed
    // and listed in the settings as such, and the library's own keys
    // underneath every named one.
    expect(installers).toEqual(['editor.ts'])
  })

  test('builds every other keymap from bindings that have a name', () => {
    const named = files.filter((one) => one.text.includes('boundKeymap(')).map((one) => one.name)

    expect(named.sort()).toEqual(['editor.ts', 'live-preview/image.ts', 'shortcuts.ts'])
  })
})
