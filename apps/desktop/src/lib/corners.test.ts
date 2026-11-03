import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { cornersSetting, cornerTokens, DEFAULT_CORNERS } from './corners'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('both choices write the same tokens, so switching leaves nothing of the other behind', () => {
  expect(Object.keys(cornerTokens('square')).sort()).toEqual(
    Object.keys(cornerTokens('rounded')).sort(),
  )
  expect(cornerTokens('nonsense')).toEqual(cornerTokens(DEFAULT_CORNERS))
  expect(cornersSetting().paint('square', 'dark')).toEqual(cornerTokens('square'))
})

test('Square is the window as it was: flush, square, divided by lines', () => {
  const square = cornerTokens('square')
  expect(square['--card-radius']).toBe('0px')
  expect(square['--card-inset']).toBe('0px')
  expect(square['--card-gap']).toBe('1px')
  expect(square['--chrome-seam']).toBe('var(--line)')
  // The theme's own sidebar ground and strip line, by leaving them unset.
  expect(square['--side-ground']).toBe('initial')
  expect(square['--strip-line']).toBe('initial')
})

test('the stylesheet starts where Rounded does, before the setting is read', () => {
  const sheet = read('../../../../packages/themes/src/tokens.css')
  for (const [token, value] of Object.entries(cornerTokens('rounded'))) {
    expect(sheet, token).toContain(`${token}: ${value};`)
  }
})

test('every surface on the frame reads its tokens rather than a corner of its own', () => {
  const readers: Record<string, string[]> = {
    'Pane.svelte': ['--card-radius', '--card-shadow', '--card-edge'],
    'PaneTree.svelte': ['--card-gap', '--chrome-seam'],
    '../App.svelte': ['--card-inset', '--chrome-ground'],
    'Sidebar.svelte': ['--side-ground', '--chrome-seam'],
    'Titlebar.svelte': ['--chrome-seam'],
    'Tabs.svelte': ['--strip-line'],
    'StatusBar.svelte': ['--card-room'],
    'overview/Overview.svelte': ['--card-radius'],
  }
  for (const [file, tokens] of Object.entries(readers)) {
    const text = read(`./${file}`)
    for (const token of tokens) expect(text, `${file} ${token}`).toContain(token)
  }
})
