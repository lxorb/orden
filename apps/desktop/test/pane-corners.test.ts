import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What floats in a note's corners is the note's pane's, never the window's (#1076): a
 *  page note's counter sat against the window's corner, under the right side once that
 *  was open. The layout itself is measured by test/e2e/pane-corners.py; this holds the
 *  rule where it is written, so nothing slips back out of the pane. */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')

const app = read('App.svelte')
const markup = app.slice(app.indexOf('</script>'), app.indexOf('<style>'))

/** The window's `corners` snippet, which the focused pane draws. */
const corners = (() => {
  const from = markup.indexOf('{#snippet corners()}')
  return from < 0 ? '' : markup.slice(from, markup.indexOf('{/snippet}', from))
})()

describe('the note’s corners', () => {
  test('the status bar and the new-note button are drawn only in the pane’s corners', () => {
    expect(corners).toContain('<StatusBar')
    expect(corners).toContain('class="fab"')
    const outside = markup.replace(corners, '')
    expect(outside).not.toContain('<StatusBar')
    expect(outside).not.toContain('class="fab"')
  })

  test('which the focused pane draws, inside its own box', () => {
    const pane = read('lib/Pane.svelte')
    expect(pane).toMatch(
      /\{#if paneCorners\.draw && workspace\.panes\.focusedId === pane\.id\}\s*\{@render paneCorners\.draw\(\)\}/,
    )
    expect(pane).toMatch(/\n {2}\.pane \{[^}]*position: relative;/)
    expect(app).toMatch(/paneCorners\.draw = corners/)
  })

  test('none of them is placed against the window', () => {
    for (const path of ['lib/StatusBar.svelte', 'lib/PagesZoom.svelte', 'lib/CanvasBar.svelte']) {
      expect(read(path), path).not.toMatch(/position:\s*fixed/)
    }
  })

  test('a bar docked to an edge finds the edge in its own frame, not the window’s', () => {
    const bar = read('lib/CanvasBar.svelte')
    expect(bar).not.toMatch(/nearestDock\([^)]*window\.inner/)
    expect(bar).toContain('frameOf(cluster)')
  })

  test('a split is as wide as its room: the divider’s pixel comes out of the shares', () => {
    const tree = read('lib/PaneTree.svelte')
    const share = /const share = \(split: Split\) =>\s*`([^`]*)`/.exec(tree)?.[1] ?? ''
    expect(share).toContain('1px')
    expect(share).not.toContain('%')
    expect(share).toMatch(/fr\)/)
  })
})
