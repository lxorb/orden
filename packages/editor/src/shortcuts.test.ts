import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { nibBindings, standardBindings, unclaimedKeymap } from './keymap'
import { bindings, boundKeymap, defaultKeyFor, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { imageBindings } from './live-preview/image'

const ALL = [...nibBindings, ...standardBindings, ...tableBindings, ...imageBindings]

/** Every key CodeMirror would answer to in a state built from these. */
function keysIn(state: EditorState): string[] {
  return state
    .facet(keymap)
    .flat()
    .flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux])
    .filter((key): key is string => !!key)
}

describe('building the keymap', () => {
  test('uses the default where nothing was chosen', () => {
    const bold = bindings(nibBindings, {}).find((one) => one.key === 'Mod-b')
    expect(bold).toBeDefined()
  })

  test('uses the chosen key where there is one', () => {
    const built = bindings(nibBindings, { 'format.bold': 'Mod-Alt-b' })

    expect(built.some((one) => one.key === 'Mod-Alt-b')).toBe(true)
    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
  })

  /** A KeyBinding with no key at all is what CodeMirror reads as "any key",
   *  so an unbound command has to be left out rather than bound to nothing. */
  test('leaves out what was unbound rather than binding it to everything', () => {
    const built = bindings(nibBindings, { 'format.bold': null })

    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
    expect(built.every((one) => one.key ?? one.mac ?? one.win ?? one.linux)).toBe(true)
  })

  test('carries the fields CodeMirror needs beside the key', () => {
    const find = bindings(standardBindings, {}).find((one) => one.key === 'Mod-f')
    // Find belongs to the search panel as well as the editor, and losing the
    // scope would stop it working from inside the panel.
    expect(find?.scope).toBe('editor search-panel')

    const next = bindings(standardBindings, {}).find((one) => one.key === 'Mod-g')
    // Shift on Find next is Find previous, in CodeMirror's own binding.
    expect(typeof next?.shift).toBe('function')
  })

  test('drops a platform default the entry does not have', () => {
    // Redo's second key is Linux's alone; it is unbound anywhere else.
    const alt = standardBindings.find((one) => one.id === 'edit.redo.alt')!

    expect(defaultKeyFor(alt, 'linux')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'win')).toBeNull()
    expect(bindings([alt], {}).length).toBe(1)
    expect(bindings([alt], {})[0]?.key).toBeUndefined()
  })
})

describe('a state built with them', () => {
  test('answers to the defaults', () => {
    const state = EditorState.create({ extensions: [shortcutExtensions(), boundKeymap(ALL)] })
    expect(keysIn(state)).toContain('Mod-b')
  })

  test('answers to a chosen key instead, without being rebuilt', () => {
    const state = EditorState.create({
      extensions: [shortcutExtensions({ 'format.bold': 'Mod-Alt-b' }), boundKeymap(ALL)],
    })

    expect(keysIn(state)).toContain('Mod-Alt-b')
    expect(keysIn(state)).not.toContain('Mod-b')
  })

  test('keeps the keys nothing has taken over', () => {
    const state = EditorState.create({ extensions: keymap.of(unclaimedKeymap) })
    // The raw editing keys: still there, and still the library's own.
    expect(keysIn(state)).toContain('ArrowLeft')
    expect(keysIn(state)).toContain('Home')
  })

  test('and hands the taken-over ones to the named bindings alone', () => {
    // Undo is named now, so the library's own Mod-z is out of the keymap
    // underneath - otherwise a rebound Undo would leave the old key working.
    const keys = keysIn(EditorState.create({ extensions: keymap.of(unclaimedKeymap) }))

    expect(keys).not.toContain('Mod-z')
    expect(keys).not.toContain('Mod-f')
    expect(keys).not.toContain('Alt-ArrowUp')
  })
})
