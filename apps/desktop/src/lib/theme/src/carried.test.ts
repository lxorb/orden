import { expect, test, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('../../platform/src/api', async (real) => ({
  ...(await real<object>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(files.get(command === 'read_custom_css' ? 'custom.css' : (args?.path ?? '')) ?? ''),
}))
import { carriedCss, customSheet, themeSheet } from './carried'

test('a theme file and the custom sheet written for the old names are read under the new ones, the files untouched', async () => {
  files.set('/themes/mine.css', '.nib-row { color: var(--nib-dim) }')
  files.set('custom.css', '#nib-frame { color: red }')
  expect(await themeSheet('/themes/mine.css')).toBe('.orden-row { color: var(--orden-dim) }')
  expect(await customSheet()).toBe('#orden-frame { color: red }')
  expect(files.get('/themes/mine.css')).toBe('.nib-row { color: var(--nib-dim) }')
  expect(files.get('custom.css')).toBe('#nib-frame { color: red }')
})

test('a sheet written for the old names styles the app under the new ones', () => {
  const old = '.nib-row, #nib-frame, [class*=" nib-glyph"] { color: var(--nib-dim) }'
  expect(carriedCss(old)).toBe('.orden-row, #orden-frame, [class*=" orden-glyph"] { color: var(--orden-dim) }')
})
test("the editor's carets and selection are reached under their old names", () => {
  const old = '.cm-editor .cm-nib-selection, .cm-nib-caret-name { color: red }'
  expect(carriedCss(old)).toBe('.cm-editor .cm-orden-selection, .cm-orden-caret-name { color: red }')
})
test('only a class, an id or a variable is renamed, never a word or another attribute', () => {
  const kept = 'a.my-nib-row, [data-x="nib-row"], .nibble'
  expect(carriedCss(kept)).toBe(kept)
})
