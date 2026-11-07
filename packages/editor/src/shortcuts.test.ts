import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { ordenBindings, standardBindings, unclaimedKeymap } from './keymap'
import { bindings, boundKeymap, defaultKeyFor, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { imageBindings } from './live-preview/image'

const ALL = [...ordenBindings, ...standardBindings, ...tableBindings, ...imageBindings]

function keysIn(state: EditorState): string[] {
  return state
    .facet(keymap)
    .flat()
    .flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux])
    .filter((key): key is string => !!key)
}

describe('building the keymap', () => {
  test('uses the default where nothing was chosen', () => {
    const bold = bindings(ordenBindings, {}).find((one) => one.key === 'Mod-b')
    expect(bold).toBeDefined()
  })

  test('uses the chosen key where there is one', () => {
    const built = bindings(ordenBindings, { 'format.bold': 'Mod-Alt-b' })

    expect(built.some((one) => one.key === 'Mod-Alt-b')).toBe(true)
    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
  })

  test('leaves out what was unbound rather than binding it to everything', () => {
    const built = bindings(ordenBindings, { 'format.bold': null })

    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
    expect(built.every((one) => one.key ?? one.mac ?? one.win ?? one.linux)).toBe(true)
  })

  test('carries the fields CodeMirror needs beside the key', () => {
    const find = bindings(standardBindings, {}).find((one) => one.key === 'Mod-f')
    expect(typeof find?.run).toBe('function')

    const next = bindings(standardBindings, {}).find((one) => one.key === 'Mod-g')
    expect(next?.shift).toBeUndefined()

    const previous = bindings(ordenBindings, {}).find((one) => one.key === 'Mod-Shift-g')
    expect(typeof previous?.run).toBe('function')
  })

  test('and no longer scopes a key to a panel the editor does not have', () => {
    const scoped = [...bindings(standardBindings, {}), ...bindings(ordenBindings, {})].filter(
      (one) => (one.scope ?? '').includes('search-panel'),
    )

    expect(scoped).toEqual([])
  })

  test('drops a platform default the entry does not have', () => {
    const alt = standardBindings.find((one) => one.id === 'edit.redo.alt')!

    expect(defaultKeyFor(alt, 'linux')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'win')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'mac')).toBeNull()
    expect(bindings([alt], {}).length).toBe(1)
    expect(bindings([alt], {})[0]?.key).toBeUndefined()

    const redo = standardBindings.find((one) => one.id === 'edit.redo')!
    expect(defaultKeyFor(redo, 'mac')).toBe('Mod-Shift-z')
  })

  test('keeps a key off the one platform that has none', () => {
    const list = ordenBindings.find((one) => one.id === 'paragraph.bullet-list')!
    expect(defaultKeyFor(list, 'mac')).toBeNull()

    const [built] = bindings([list], {})
    expect(built?.key).toBeUndefined()
    expect(built?.mac).toBeUndefined()
    expect(built?.win).toBe('Mod-Shift-]')
    expect(built?.linux).toBe('Mod-Shift-]')
  })

  test('still binds a key the reader chose there', () => {
    const list = ordenBindings.find((one) => one.id === 'paragraph.bullet-list')!
    const [built] = bindings([list], { 'paragraph.bullet-list': 'Mod-Alt-l' })
    expect(built?.key).toBe('Mod-Alt-l')
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
    expect(keysIn(state)).toContain('ArrowLeft')
    expect(keysIn(state)).toContain('Home')
  })

  test('and hands the taken-over ones to the named bindings alone', () => {
    const keys = keysIn(EditorState.create({ extensions: keymap.of(unclaimedKeymap) }))

    expect(keys).not.toContain('Mod-z')
    expect(keys).not.toContain('Mod-f')
    expect(keys).not.toContain('Alt-ArrowUp')
  })

  test('and installs each of the search keys once', () => {
    const installed = EditorState.create({
      extensions: [shortcutExtensions(), boundKeymap(ALL), keymap.of(unclaimedKeymap)],
    })

    const counted = new Map<string, number>()
    for (const chord of keysIn(installed)) counted.set(chord, (counted.get(chord) ?? 0) + 1)

    for (const chord of ['Mod-f', 'Mod-g', 'F3', 'Mod-Alt-g']) {
      expect(counted.get(chord), chord).toBe(1)
    }

    expect(counted.get('Mod-Shift-l')).toBeUndefined()
    expect(counted.get('Mod-d')).toBeUndefined()
  })

  test('leaves the library nothing on the key source mode uses', () => {
    const keys = keysIn(EditorState.create({ extensions: keymap.of(unclaimedKeymap) }))

    expect(keys).not.toContain('Mod-/')
  })
})
