import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** The window's frame is the one look since #1102: a rounded card a few pixels in from
 *  the chrome, the chrome one surface round it. tokens.css says it, and nothing writes
 *  another; full screen and a touch screen alone are flush (App.svelte). */
const ROUNDED: Record<string, string> = {
  '--card-radius': '10px',
  '--card-inset': '6px',
  '--card-gap': '6px',
  '--card-edge': 'var(--line)',
  '--card-shadow': '0 1px 3px rgb(0 0 0 / 0.12)',
  '--chrome-ground': 'var(--tab-frame)',
  '--chrome-seam': 'transparent',
  '--side-ground': 'transparent',
  '--strip-line': 'transparent',
}

test('the stylesheet is the rounded frame, the only one', () => {
  const sheet = read('../../../../packages/themes/src/tokens.css')
  for (const [token, value] of Object.entries(ROUNDED)) {
    expect(sheet, token).toContain(`${token}: ${value};`)
  }
})

test('nothing offers another frame: no setting, no file of its choices', () => {
  expect(read('./theme.svelte.ts')).not.toMatch(/cornersSetting|'\.\/corners'/)
  expect(read('../../../../packaging/nix/settings-schema.json')).not.toContain('appearance.corners')
})

test('every surface on the frame reads its tokens rather than a corner of its own', () => {
  const readers: Record<string, string[]> = {
    'Pane.svelte': ['--card-radius', '--card-shadow', '--card-edge'],
    'PaneTree.svelte': ['--chrome-seam'],
    // The room between a split's cards, one rule for the panes and the strips over them
    // in the bar (#1037).
    'workspace/pane-tree.ts': ['--card-gap'],
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
 *  which has no hard cuts: only the seam, which full screen and a touch screen draw. */
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
