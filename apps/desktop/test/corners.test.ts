import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const read = (path: string) => readFileSync(join(import.meta.dirname, '../src/lib', path), 'utf8')
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
  expect(read('./theme/src/theme.svelte.ts')).not.toMatch(/cornersSetting|'\.\/corners'/)
})
test('every surface on the frame reads its tokens rather than a corner of its own', () => {
  const readers: Record<string, string[]> = {
    'pane-tree/src/Pane.svelte': ['--card-radius', '--card-shadow', '--card-edge'],
    'pane-tree/src/PaneTree.svelte': ['--chrome-seam'],
    'panes/src/pane-tree.ts': ['--card-gap'],
    '../App.svelte': ['--card-inset', '--chrome-ground'],
    'sidebar/src/Sidebar.svelte': ['--side-ground', '--chrome-seam'],
    'sidebar/src/SidebarFoot.svelte': ['--chrome-seam'],
    'titlebar/src/Titlebar.svelte': ['--chrome-seam'],
    'tab-strip/src/Tabs.svelte': ['--strip-line'],
    'frame/src/StatusBar.svelte': ['--card-room'],
    'overview/src/Overview.svelte': ['--card-radius'],
  }
  for (const [file, tokens] of Object.entries(readers)) {
    const text = read(`./${file}`)
    for (const token of tokens) expect(text, `${file} ${token}`).toContain(token)
  }
})
test('the sidebar draws its separators with the seam, never with a line of its own', () => {
  for (const file of ['sidebar/src/Sidebar.svelte', 'sidebar/src/SidebarFoot.svelte']) {
    const style = /<style[^>]*>([\s\S]*)<\/style>/.exec(read(`./${file}`))?.[1] ?? ''
    expect(style, file).not.toMatch(/border(?:-[a-z]+)*:\s*1px solid var\(--line\)/)
  }
})
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
test('every sidebar over the note stands on the paper, under the chrome and its own ground', () => {
  const over: [string, RegExp][] = [
    ['../App.svelte', /:global\(\[data-drawer\]\) \.panels \{([^}]*)\}/],
    ['sidebar/src/Sidebar.svelte', /\n {2}\.column\.shut\.floating aside \{([^}]*)\}/],
  ]
  for (const [file, selector] of over) {
    const rule = selector.exec(read(`./${file}`))?.[1] ?? ''
    const ground = /background:([^;]*);/.exec(rule.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''
    expect(ground.replace(/\s+/g, ' ').trim(), file).toBe(
      'linear-gradient(var(--side-ground), var(--side-ground)), linear-gradient(var(--chrome-ground), var(--chrome-ground)), var(--bg)',
    )
  }
})
test('a pane is a rounded card, but square and flush where it meets the window with no sidebar between', () => {
  const pane = read('./pane-tree/src/Pane.svelte')
  expect(/\n {2}\.pane \{([^}]*)\}/.exec(pane)?.[1]).toContain('border-radius: var(--card-radius);')
  for (const toward of ['left', 'right', 'down'])
    expect(pane).toContain(`!paneToward(workspace.panes.frame, pane.id, '${toward}')`)
  expect(/\.pane\.at-left \{([^}]*)\}/.exec(pane)?.[1]).toContain('var(--left-edge, var(--card-radius))')
  expect(/\.pane\.at-right \{([^}]*)\}/.exec(pane)?.[1]).toContain('var(--right-edge, var(--card-radius))')
  expect(/\.pane\.at-foot \{([^}]*)\}/.exec(pane)?.[1]).toMatch(
    /border-bottom-left-radius: 0;\s*border-bottom-right-radius: 0;/,
  )
  expect(pane).not.toMatch(/grounded|--card-foot|flushBottom/)
  const app = read('../App.svelte')
  expect(app).toMatch(/const leftShut = \$derived\(viewport\.drawer \|\| workspace\.openOn\('left'\) === null\)/)
  expect(app).toMatch(/const rightShut = \$derived\(viewport\.drawer \|\| !rightOpen\)/)
  expect(app).toContain('class:left-shut={leftShut}')
  expect(app).toContain('class:right-shut={rightShut}')
  expect(/\n {2}\.panes \{([^}]*)\}/.exec(app)?.[1]).toContain(
    'padding: 0 var(--right-inset, var(--card-inset)) 0 var(--left-inset, var(--card-inset));',
  )
  for (const side of ['left', 'right']) {
    const rule = new RegExp(`\\.document\\.${side}-shut \\{([^}]*)\\}`).exec(app)?.[1] ?? ''
    expect(rule, side).toContain(`--${side}-inset: 0px;`)
    expect(rule, side).toContain(`--${side}-edge: 0px;`)
  }
  expect(app).not.toMatch(/grounded|flushBottom/)
  expect(read('./modes/src/modes.svelte.ts')).not.toContain('flushBottom: boolean')
  expect(read('./web-tab/src/WebTab.svelte')).toContain('cardCorner(hole)')
})
