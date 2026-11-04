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
    // The line over the sidebar's foot, which Rounded leaves out (#1105).
    'SidebarFoot.svelte': ['--chrome-seam'],
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

/** #1105: no hairline drawn with the theme's own line anywhere on the sidebar's chrome,
 *  where Rounded has no hard cuts: only the seam, which Square draws. */
test('the sidebar draws its separators with the seam, never with a line of its own', () => {
  for (const file of ['Sidebar.svelte', 'SidebarFoot.svelte']) {
    const style = /<style[^>]*>([\s\S]*)<\/style>/.exec(read(`./${file}`))?.[1] ?? ''
    expect(style, file).not.toMatch(/border(?:-[a-z]+)*:\s*1px solid var\(--line\)/)
  }
})

/** #1103: a tab filling the window kept the card's inset and corner, because the card
 *  was flush only in full screen and for a file alone. One condition says that nothing of
 *  the app's stands round what is open, every full mode in it, and the tokens follow it;
 *  test/e2e/full-window.py measures each mode, a note and a web tab. */
test('every full mode makes the card flush through one condition', () => {
  const app = read('../App.svelte')
  expect(app).toMatch(/const flush = \$derived\(bare \|\| filled\)/)
  expect(app).toMatch(/const bare = \$derived\(fullscreen\.on \|\| alone\.on\)/)
  expect(app).toMatch(/const filled = \$derived\(workspace\.panes\.fills !== null\)/)
  const rule = /main\.flush,[^{]*\{([^}]*)\}/.exec(app)?.[1] ?? ''
  for (const token of ['--card-radius', '--card-inset', '--card-edge', '--card-shadow']) {
    expect(rule, token).toContain(token)
  }
})
