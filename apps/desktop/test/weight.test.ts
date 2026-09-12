import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the app evaluates before it has drawn anything.
 *
 *  Emil wants nib to open like Notepad, and the one number that decides whether it
 *  can is the size of the module graph in front of the first paint: every module
 *  reached by a static import from `src/main.ts` is fetched, parsed and run before a
 *  window is on screen, whether or not the reader ever uses what is in it.
 *
 *  Batch 109 measured that graph at 3.41 megabytes of built JavaScript and brought it
 *  to 1.91. Nothing in it was wrong; it was five static imports of things that are
 *  almost never needed at once - the whole Lucide set for seven file marks, KaTeX and
 *  its chemistry pack and the emoji table for the notes that have a formula or a
 *  `:shortcode:` in them, the Vim keymap for a mode that is off, the canvas and the
 *  PDF viewer and the graph and the settings sheet for a window that opens on a note.
 *
 *  Each of those is one edge in this graph, and any of them can come back by
 *  accident: a barrel import instead of a file, a type that was not imported as a
 *  type, a helper moved into a module that happens to sit behind a library. So the
 *  graph is measured here rather than remembered, and this is the only test in the
 *  repository whose job is to fail when somebody makes the app slower to open.
 *
 *  Read off the source rather than out of a bundle, the way
 *  packages/editor/test/weight.test.ts is, so it needs no build and answers the same
 *  whichever bundler the app is built with. It counts our own source; the packages it
 *  reaches are held to a list of names instead, because what a library weighs is not
 *  something a file in this repository can read. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url))

/** The workspace packages, by the name an import asks for them under. Resolved
 *  through each one's own `exports` map, so a subpath reaches the module that subpath
 *  exists for - which is the whole point of having them. */
const WORKSPACE = ['@nib/editor', '@nib/glasses', '@nib/markdown', '@nib/rooms', '@nib/themes']

/** Where a workspace import lands, or null when the specifier is not one of ours. */
function workspaceFile(specifier: string): string | null {
  const name = WORKSPACE.find((one) => specifier === one || specifier.startsWith(`${one}/`))
  if (!name) return null

  const folder = join(ROOT, 'packages', name.slice('@nib/'.length))
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>
  }
  const sub = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  const target = manifest.exports?.[sub]

  return target === undefined ? null : resolve(folder, target)
}

/** Where a relative import lands. The extensions a bundler would try, in its order. */
function relativeFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const tries = [base, `${base}.ts`, `${base}.svelte`, `${base}.js`, join(base, 'index.ts')]

  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

/** A static `import` or `export … from`, and a bare `import 'x'` for its side effects.
 *  A dynamic `import(…)` is a boundary by definition and is not matched: the whole
 *  question here is what runs before anything is drawn. */
const STATIC =
  /(?:^|[\n;}])[^\S\n]*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\n;}])[^\S\n]*import\s*['"]([^'"]+)['"]/g

/** A comment, so a specifier written in prose is not read as an import. Every file in
 *  this repository is heavily commented and several of the comments name modules. */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g

/** What a file asks for at load time. `import type` is erased before anything runs, so
 *  a type from a heavy module costs nothing and is left out. */
function asked(file: string): string[] {
  const source = readFileSync(file, 'utf8').replace(COMMENTS, (whole, head?: string) => head ?? '')
  const found: string[] = []

  for (const match of source.matchAll(STATIC)) {
    const specifier = match[1] ?? match[2]
    if (specifier === undefined) continue
    if (/\b(?:import|export)\s+type\b/.test(match[0])) continue

    found.push(specifier)
  }

  return found
}

/** Every file the entry reaches without crossing a dynamic import, and every package
 *  any of them asks for. */
function eagerGraph(entry: string): { files: string[]; packages: Set<string>; bytes: number } {
  const files: string[] = []
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || files.includes(file)) continue
    files.push(file)

    for (const specifier of asked(file)) {
      // A stylesheet is not a module graph: it is a rule, and the faces inside it are
      // fetched only once something on the page wears one.
      if (specifier.endsWith('.css')) continue

      const found = specifier.startsWith('.')
        ? relativeFile(file, specifier)
        : workspaceFile(specifier)
      if (found) queue.push(found)
      else if (!specifier.startsWith('.')) packages.add(specifier)
    }
  }

  const bytes = files.reduce((sum, one) => sum + statSync(one).size, 0)

  return { files, packages, bytes }
}

const graph = eagerGraph(ENTRY)
const names = new Set(graph.files.map((one) => one.replace(/\\/g, '/')))

/** Whether any file in the graph is this one, named by the tail of its path. */
function holds(tail: string): boolean {
  return [...names].some((one) => one.endsWith(tail))
}

/** How much of our own source the app reads before it draws anything, in bytes, and
 *  how many files that is.
 *
 *  3,447,446 bytes over 424 files as this is written, measured on 2026-09-12, against
 *  1.91 MB of built JavaScript in the chunks `index.html` preloads - source counts
 *  the comments, and this repository has a great many of them. Both ceilings are ten
 *  per cent over what was measured: close enough that a whole subsystem arriving
 *  eagerly fails here, wide enough that a fortnight of ordinary work on the shell
 *  does not.
 *
 *  Our own source only, and the library names below instead, because what a package in
 *  `node_modules` weighs is not something this file can read - and because the
 *  libraries are where the megabytes were in the first place. Which is also why the
 *  count matters beside the bytes: every one of these modules is parsed and run before
 *  a window is on screen, and half of them are twenty lines. */
const BUDGET = 3_790_000
const MOST_FILES = 466

describe('what the app evaluates before it draws anything', () => {
  test('is under the budget, in bytes of our own source', () => {
    expect(graph.bytes).toBeLessThan(BUDGET)
  })

  test('and under it in modules, which is what the parsing costs', () => {
    expect(graph.files.length).toBeLessThan(MOST_FILES)
  })

  /** Every one of these was in the first paint's graph before batch 109, and each is
   *  here because of the edge that put it there. Named rather than weighed: this file
   *  cannot read what a package in `node_modules` costs, and the point is the edge. */
  test.each([
    // The whole stroked set, six thousand icons, because file-mark.ts imported seven
    // of them off the library's index instead of out of their own files. The index is
    // loaded when the picker or a row wants an icon nobody named at build time; see
    // src/lib/icons.ts.
    ['lucide', 'the icon library'],
    // The formula engine, its chemistry pack and the emoji table, because the renderer
    // imported all three outright. Loaded when a note turns out to have a formula or a
    // `:shortcode:` in it; see @nib/markdown/engines.
    ['katex', 'the formula engine'],
    ['katex/contrib/mhchem', 'the chemistry pack'],
    ['node-emoji', 'the emoji table'],
    // The Vim keymap, for a mode that is off unless somebody turned it on. Loaded when
    // modal editing is asked for; see packages/editor/src/vim.ts.
    ['@replit/codemirror-vim', 'the vim keymap'],
    // The firmware font metrics, because the app's mode settings read the glasses'
    // compaction names off the package that also holds its text engine. Those names
    // are @nib/glasses/choices now.
    ['@evenrealities/pretext', 'the firmware font metrics'],
    // These four were already behind a boundary and must stay there: the diagram
    // drawers, the PDF viewer, and the writers an export loads.
    ['mermaid', 'the diagram drawer'],
    ['flowchart.js', "Typora's flowcharts"],
    ['pdfjs-dist', 'the PDF viewer'],
    ['docx', 'the Word writer'],
    ['jszip', 'the zip writer'],
    ['pdf-lib', 'the PDF writer'],
    ['emojilib', "the emoji table's own names"],
    ['unicode-emoji-json', 'the emoji index'],
    ['lucide-static', "Lucide's tags"],
  ])('does not reach %s (%s)', (asked) => {
    expect([...graph.packages]).not.toContain(asked)
  })

  /** And the same for our own code: the surfaces a window does not open on, and the
   *  two modules whose whole job is to import a library outright. */
  test.each([
    ['/lib/Canvas.svelte', 'the canvas'],
    ['/lib/canvas/ink.ts', "the canvas's ink"],
    ['/lib/Graph.svelte', 'the graph'],
    ['/lib/graph-layout.ts', "the graph's layout"],
    ['/lib/Pdf.svelte', 'the PDF viewer'],
    ['/lib/Pages.svelte', 'the pages surface'],
    ['/lib/PagesNavigator.svelte', "the pages surface's thumbnails"],
    ['/lib/web-tab/WebTab.svelte', 'the web tab'],
    ['/lib/SettingsPanel.svelte', 'the settings sheet'],
    ['/lib/export.ts', 'the exporters'],
    ['/editor/src/vim-mode.ts', "the vim mode's own module"],
    ['/markdown/src/maths.ts', 'the formula engine, dressed'],
    ['/markdown/src/eager.ts', "the Worker's pair of engines"],
    ['/glasses/src/mark.ts', "the glasses' text engine"],
  ])('nor %s (%s)', (tail) => {
    expect(holds(tail), tail).toBe(false)
  })

  /** The other half of the claim: the graph is not small because the walk is broken.
   *  These are the modules a window does open on, and all of them must be in it. */
  test.each([
    ['/src/App.svelte', 'the app'],
    ['/lib/Pane.svelte', 'a pane'],
    ['/lib/Editor.svelte', 'the editor'],
    ['/lib/Tree.svelte', 'the file list'],
    ['/editor/src/editor.ts', "the editor's own state"],
    ['/markdown/src/index.ts', 'the renderer'],
    ['/markdown/src/engines.ts', 'the holder the two heavy libraries arrive in'],
  ])('while %s (%s) is', (tail) => {
    expect(holds(tail), tail).toBe(true)
  })

  test('and CodeMirror with the markdown mode, which is what shows a note', () => {
    for (const wanted of [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/lang-markdown',
      'svelte',
    ]) {
      expect([...graph.packages], wanted).toContain(wanted)
    }
  })
})
