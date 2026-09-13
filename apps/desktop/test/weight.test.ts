import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
 *  Batch 109 measured that graph at 3.20 megabytes of built JavaScript and brought it
 *  to 1.70. Nothing in it was wrong; it was five static imports of things that are
 *  almost never needed at once - the whole Lucide set for seven file marks, KaTeX and
 *  its chemistry pack and the emoji table for the notes that have a formula or a
 *  `:shortcode:` in them, the Vim keymap for a mode that is off, the canvas and the
 *  PDF viewer and the graph and the settings sheet for a window that opens on a note.
 *
 *  Batch 110 took the same 1.70 to 1.47, and every one of the four was the same shape
 *  again: the sheets App.svelte mounted for a window that shows none of them, the
 *  collaboration engine for a session nobody has signed in to, the list of a hundred
 *  and forty-three fence languages for a note with no fence in it, and the HTML
 *  converter for a paste of plain text. Each is one edge below.
 *
 *  Batch 118 took the built figure from 1.52 megabytes to 1.35, and that one was not an
 *  edge of ours at all: `@codemirror/lang-markdown` imports `@codemirror/lang-html` for
 *  the raw blocks and inline tags in a note, which brings the CSS and JavaScript
 *  grammars and the LR parser runtime with it - a hundred and sixty-seven kilobytes,
 *  fourteen milliseconds of the launch measured in Chrome, for the notes that have a
 *  tag in them. What that package asks for now is a door of nib's own, said once in the
 *  root manifest; see packages/lang-html. Which is why the last two tests here are
 *  about a manifest and a dynamic import rather than about this graph: the edge that
 *  holds those five packages out is inside a dependency, where no walk of our own
 *  source can see it.
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
  const source = readFileSync(file, 'utf8').replace(COMMENTS, (_whole, head?: string) => head ?? '')
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
 *  3,084,181 bytes over 382 files as this is written, measured on 2026-09-13, against
 *  1,354,371 bytes of built JavaScript in the chunks `index.html` preloads - source
 *  counts the comments, and this repository has a great many of them. Both ceilings
 *  are ten per cent over what was measured: close enough that a whole subsystem
 *  arriving eagerly fails here, wide enough that a fortnight of ordinary work on the
 *  shell does not.
 *
 *  The two figures move independently, which is the point of having both: batch 118
 *  took a hundred and sixty-seven kilobytes out of the built one and put five hundred
 *  bytes of comment into this one, because what it moved was a library's own import.
 *
 *  Our own source only, and the library names below instead, because what a package in
 *  `node_modules` weighs is not something this file can read - and because the
 *  libraries are where the megabytes were in the first place. Which is also why the
 *  count matters beside the bytes: every one of these modules is parsed and run before
 *  a window is on screen, and half of them are twenty lines.
 *
 *  The built figure beside it is what a browser actually fetches before the entry
 *  module has run, and it is read off the build rather than from here:
 *
 *      pnpm exec vite build --mode production
 *
 *  then sum the `assets/*.js` that `dist/index.html` names - the entry script and
 *  every `rel="modulepreload"` beside it, which is exactly the eager graph as the
 *  bundler chunked it. Anything not in that list is behind a dynamic import. */
const BUDGET = 3_400_000
const MOST_FILES = 420

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
    // Batch 110's four. The collaboration engine, which is what a room costs and is
    // of no use until somebody signs in: it comes with the account now, because a
    // room is only ever joined for a file the account holds. See rooms.svelte.ts.
    ['yjs', 'the shared document'],
    ['y-protocols/awareness', 'the awareness protocol'],
    // The stock list of a hundred and forty-three fence languages - the list, not the
    // parsers, which were always fetched one at a time. It arrives with the first
    // fence that names a language; see packages/editor/src/languages.ts.
    ['@codemirror/language-data', 'the language list'],
    // The HTML converter, which arrives with the first page pasted or clipped. See
    // packages/editor/src/paste.ts.
    ['turndown', 'the HTML converter'],
    ['turndown-plugin-gfm', "the converter's GFM rules"],
    // Batch 118's five, which arrive with the first note that has a tag in it. The HTML
    // grammar is what colours a raw block or an inline tag, and it brings the other four
    // with it: CSS and JavaScript for what a `<style>` and a `<script>` inside it hold,
    // and the LR parser runtime all three are built on, which nothing else eager needs -
    // markdown's own parser is written by hand. Reached through packages/lang-html, and
    // through the fences that name them; never from here.
    ['@codemirror/lang-html', 'the HTML grammar'],
    ['@codemirror/lang-css', 'the CSS grammar'],
    ['@codemirror/lang-javascript', 'the JavaScript grammar'],
    ['@lezer/html', "HTML's own"],
    ['@lezer/css', "CSS's own"],
    ['@lezer/javascript', "JavaScript's own"],
    ['@lezer/lr', 'the parser runtime under all three'],
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
    // The sheets App.svelte used to mount for a window that shows none of them. Each
    // is latched there and fetched the first time something opens it; see surfaces.ts.
    ['/lib/History.svelte', 'the version list'],
    ['/lib/ShareSheet.svelte', 'the share sheet'],
    ['/lib/PublishSheet.svelte', 'the publish sheet'],
    ['/lib/ImportSheet.svelte', 'the import sheet'],
    ['/lib/IconPicker.svelte', 'the icon picker'],
    ['/lib/Slides.svelte', 'the deck'],
    // The two kinds of room and the protocol under them, which is where yjs came in.
    ['/lib/rooms/room.ts', "a note's room"],
    ['/lib/rooms/plane.ts', "a canvas's room"],
    ['/rooms/src/index.ts', 'the room protocol'],
    // The fence languages: the vocabulary, the modes beside it and Mermaid's own.
    ['/editor/src/language-spellings.ts', "the fence languages' vocabulary"],
    ['/editor/src/language-modes.ts', 'the languages nobody ported'],
    ['/editor/src/mermaid.ts', "the diagram fence's tokenizer"],
    // And the converter a pasted page goes through.
    ['/markdown/src/from-html.ts', 'the HTML converter'],
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
    // The doors of the four above, which are the other half of each claim: a boundary
    // nothing reaches is a subsystem somebody deleted rather than one somebody moved.
    ['/lib/surfaces.ts', 'the doors the sheets come through'],
    ['/lib/rooms.svelte.ts', 'the store that joins a room'],
    ['/editor/src/languages.ts', "the fence languages' door"],
    ['/editor/src/paste.ts', 'the paste that asks for the converter'],
  ])('while %s (%s) is', (tail) => {
    expect(holds(tail), tail).toBe(true)
  })

  /** The thirty-nine catalogues, which are the other side of the same bargain: one
   *  chunk per language, fetched when a reader chooses one. Between them they are
   *  larger than everything else this test is about, and a single static import of any
   *  of them would put every row of every language in front of the first paint. See
   *  src/lib/i18n.svelte.ts, which loads them. */
  test('and no catalogue of any language', () => {
    const catalogues = readdirSync(fileURLToPath(new URL('../src/locales/', import.meta.url)))
    expect(catalogues.length).toBeGreaterThan(30)

    for (const one of catalogues) {
      expect(holds(`/locales/${one}`), one).toBe(false)
    }
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

  /** The markdown mode above is why the HTML grammar has to be kept out from inside a
   *  dependency rather than from here.
   *
   *  `markdown()` builds `html({ matchClosingTags: false })` at module level for the raw
   *  blocks and inline tags in a note, so the import stands whether or not anybody asks
   *  for it - and the export that reads it cannot be dropped either, because
   *  `@codemirror/language-data` names `markdown()` for the ```markdown fence, which
   *  keeps every export of that module alive in whatever chunk holds it. The editor
   *  holds it in the first chunk: the base parser is in it, and so are the two keys that
   *  continue a list and take a level of markup off.
   *
   *  So the grammar is substituted instead, once, in the root manifest. These two are
   *  that edge: the manifest still says it, and the door still asks for the grammar
   *  rather than importing it. Either one gone and the five packages above are back in
   *  front of the first paint, with nothing else in this file any the wiser. */
  const OVERRIDE = '@codemirror/lang-markdown>@codemirror/lang-html'
  const DOOR = join(ROOT, 'packages/lang-html/src/index.ts')

  test('and the HTML grammar comes through nib’s own door, as the manifest says', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }

    expect(manifest.pnpm?.overrides?.[OVERRIDE]).toBe('workspace:@nib/lang-html@*')
    expect(existsSync(DOOR)).toBe(true)
  })

  test('and the door asks for the grammar rather than importing it', () => {
    expect(asked(DOOR)).not.toContain('@codemirror/lang-html')
    expect(readFileSync(DOOR, 'utf8')).toContain("import('@codemirror/lang-html')")
  })
})
