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

    // editor.ts holds three of them, and all three are keys that belong to the
    // text rather than choices anybody made: Enter closing a code fence, Down
    // opening a line under a block that ends the note, and the library's own keys
    // underneath every named one. The settings list says as much of the arrows and
    // of Enter; see FIXED_ENTRIES in the registry.
    //
    // completing.ts holds one more, and it is the same kind of key: the library's own
    // Backspace, which takes both halves of a bracket pair out at once. It used to be
    // in `unclaimedKeymap` with the rest of the library's keys, and it moved because
    // the package it comes from is fetched rather than carried - thirty-five kilobytes
    // of popup that nothing needs before somebody types; see
    // packages/editor/src/completion.ts. It is bound only while the pairs are being
    // made, which is what it is about, and it is still nobody's to rebind.
    expect(installers).toEqual(['completing.ts', 'editor.ts'])
  })

  /** And nothing but the engine's own module names the search library.
   *
   *  This is the edge that keeps fifteen kilobytes out of the first paint, and the
   *  keymap is where it was: `keymap.ts` used to read `searchKeymap` in order to adopt
   *  Find, the two steps and goto-line off it, and reading that array is importing the
   *  engine. Those four are declared by hand now and the keys run nib's own commands
   *  through a door; see find.ts. One import of the package anywhere else in this
   *  package - a helper reaching for `getSearchQuery`, a keymap adopting a binding
   *  again - and the engine is back in front of the window.
   *
   *  The other half of this claim is in weight.test.ts, which says the package is not
   *  in the graph the first paint walks. This one says where it may be named at all,
   *  because that is the mistake somebody makes. */
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
  /** A hint typed out by hand is a promise the app stops keeping the moment
   *  someone rebinds the key: the menu still says Ctrl B while Ctrl+Alt+B is
   *  what works. Six rows of the editor's context menu, one tab menu row and
   *  the whole palette read that way until the registry arrived. Every hint
   *  therefore comes from `shortcuts.hint(id)`, and this is what says so. */
  test('never spell a shortcut out by hand', () => {
    const guilty = markup(APP)
      .map((path) => ({
        name: path.slice(APP.length).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
      }))
      .filter((one) => /hint: '[^']/.test(one.text))
      .map((one) => one.name)

    expect(guilty).toEqual([])
  })
})
