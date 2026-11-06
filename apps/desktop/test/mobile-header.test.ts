import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

function componentsWith(glyph: string): string[] {
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.svelte') && readFileSync(path, 'utf8').includes(glyph)) {
        found.push(path.slice(SOURCE.length).replace(/\\/g, '/'))
      }
    }
  }

  walk(SOURCE)
  return found.sort()
}

const titlebar = read('lib/Titlebar.svelte')
const sidebar = read('lib/Sidebar.svelte')
const toggle = read('lib/SidebarToggle.svelte')

const PANEL = '<rect x="1" y="2.5" width="12" height="9" rx="1.5" />'

describe('the button that opens the file list', () => {
  test('is one component, drawn once', () => {
    expect(toggle).toContain(PANEL)
    expect(toggle).toContain("t('Hide left sidebar')")

    for (const [name, text] of [
      ['lib/Titlebar.svelte', titlebar],
      ['lib/Sidebar.svelte', sidebar],
    ] as const) {
      expect(text, `${name} draws the glyph again`).not.toContain(PANEL)
      expect(text, `${name} uses the component`).toMatch(
        /<SidebarToggle unseen=\{(swiped \|\| \(!viewport\.touch && sideToggles\.inside\)|swipeOpens\(\))\} \/>/,
      )
    }
  })

  test('is not in the bar while there is nothing to list', () => {
    expect(titlebar).toMatch(
      /\{#if !listless && \(viewport\.touch \|\| !sideToggles\.inside \|\| !workspace\.openOn\('left'\)\)\}\s*<SidebarToggle unseen=\{swiped \|\| \(!viewport\.touch && sideToggles\.inside\)\} \/>/,
    )
    expect(titlebar).toContain('!workspace.spaces.length && !workspace.tabs.length')
  })

  test('is said and not shown in the drawer head on the same condition as the bar', () => {
    expect(sidebar).toContain("import { swipeOpens } from './swipe-opens'")
    expect(sidebar.replace(/\s+/g, ' ')).toContain('<SidebarToggle unseen={swipeOpens()} />')
  })

  test("the bar's start steps in by a glyph's margin while its button is not seen", () => {
    const style = titlebar.slice(titlebar.indexOf('<style>')).replace(/\s+/g, ' ')
    expect(style).toContain(
      'padding-inline-start: calc(var(--inset-start) + (var(--row-height) - var(--icon-lg)) / 2);',
    )
    expect(style).toContain(
      ":global([data-touch]) header:has(> :global([data-side-toggle='left']:not(.nib-said))) { padding-inline-start: var(--inset-start); }",
    )
  })

  test('is said and not shown where a swipe from the edge pulls the list out', () => {
    expect(titlebar).toContain('const swiped = $derived(swipeOpens())')
    expect(read('App.svelte')).toContain('if (!host || !swipeOpens()) return')
    expect(toggle).toContain('class:nib-said={unseen && !keyed}')
    expect(titlebar).toMatch(/hint="drawer"/)
    expect(read('lib/hints.svelte.ts')).toMatch(/HINTS = \['drawer'/)
  })

  test('and nothing else anywhere draws one', () => {
    const others = componentsWith(PANEL).filter((name) => name !== 'lib/SidebarToggle.svelte')
    expect(others, `these draw the sidebar glyph again: ${others.join(', ')}`).toEqual([])
  })

  test('says which way it is in words rather than by redrawing itself', () => {
    expect(toggle).toContain('aria-pressed={open}')
    expect(toggle).toContain("t('Hide left sidebar')")
    expect(toggle).toContain("t('Show left sidebar')")
    expect(toggle).toContain("t('Hide right sidebar')")
    expect(toggle).toContain("t('Show right sidebar')")

    const style = toggle.slice(toggle.indexOf('<style>'))
    for (const shifting of [
      /\.edge[^}]*transform:/,
      /\.edge[^}]*opacity:/,
      /\.edge[^}]*display:/,
    ]) {
      expect(style, `the edge is drawn one way: ${shifting.source}`).not.toMatch(shifting)
    }
  })

  test('is in the drawer head exactly where the sidebar is a drawer', () => {
    const squeezed = sidebar.replace(/\s+/g, ' ')

    expect(squeezed).toContain(
      '{#if viewport.drawer || (!viewport.touch && sideToggles.inside)} <SidebarToggle unseen={swipeOpens()} /> {/if}',
    )
    expect(squeezed).toContain('{#if side === \'left\'} <div class="head"')
  })
})

describe("the sides' buttons on a desktop", () => {
  test('are in the sides', () => {
    expect(sidebar.replace(/\s+/g, ' ')).toContain(
      '{#if side === \'right\' && !viewport.touch && sideToggles.inside} <SidebarToggle side="right" /> {/if}',
    )
  })

  test('are in the bar only while the side is shut, and only said there', () => {
    const squeezed = titlebar.replace(/\s+/g, ' ')
    expect(squeezed).toContain(
      '{:else if (workspace.right.length || !__EVEN_PLUGIN__) && workspace.rightShows === null} <SidebarToggle side="right" unseen />',
    )
    expect(squeezed).toContain(
      '{#if viewport.touch} {#if workspace.right.length} <SidebarToggle side="right" /> {/if}',
    )
  })

  test('are in the bar, shown, unless the setting puts them in the sides', () => {
    const squeezed = titlebar.replace(/\s+/g, ' ')
    expect(squeezed).toContain(
      '{:else if !sideToggles.inside} {#if workspace.right.length || !__EVEN_PLUGIN__} <SidebarToggle side="right" /> {/if}',
    )
    expect(read('lib/side-toggles.svelte.ts')).toContain("storedText(KEY) === 'yes'")
    expect(read('lib/Sidebar.svelte')).toContain(
      "if (viewport.touch || (side === 'right' && !sideToggles.inside)) return",
    )
  })

  test('and somebody new is told once that the edge brings the list out', () => {
    expect(titlebar).toMatch(/hint="edge"/)
    expect(titlebar).toContain("when={!workspace.openOn('left')}")
    expect(read('lib/hints.svelte.ts')).toMatch(/HINTS = \['drawer', 'edge'/)
  })
})

describe('the menu of the whole app', () => {
  test('is in no bar, on a desktop or on a phone', () => {
    expect(titlebar).not.toContain('AppMenu')
    expect(titlebar).not.toContain('menu.show')
    expect(componentsWith('<AppMenu ')).toEqual([])
  })
})

describe('the search button', () => {
  test('opens the palette, says its key on the tooltip, and is in both bars', () => {
    expect(titlebar).toContain("title={shortcuts.tooltip(t('Search'), 'app.palette')}")
    expect(titlebar).toContain('onclick={() => onpalette()}')
    expect(titlebar.match(/\{@render searchGlyph\(\)\}/g) ?? []).toHaveLength(2)
  })
})
