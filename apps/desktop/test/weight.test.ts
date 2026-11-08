import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ENTRY = join(import.meta.dirname, '../src/main.ts')

const WORKSPACE = [
  '@orden/editor',
  '@orden/glasses',
  '@orden/markdown',
  '@orden/rooms',
  '@orden/themes',
]

function workspaceFile(specifier: string): string | null {
  const name = WORKSPACE.find((one) => specifier === one || specifier.startsWith(`${one}/`))
  if (!name) return null

  const folder = join(ROOT, 'packages', name.slice(name.indexOf('/') + 1))
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>
  }
  const sub = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  const target = manifest.exports?.[sub]

  return target === undefined ? null : resolve(folder, target)
}

function relativeFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const tries = [base, `${base}.ts`, `${base}.svelte`, `${base}.js`, join(base, 'index.ts')]

  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

const STATIC =
  /(?:^|[\n;}])[^\S\n]*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\n;}])[^\S\n]*import\s*['"]([^'"]+)['"]/g

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g

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

const TEXT = /\?(?:raw|inline)$/

function assetFile(from: string, specifier: string): string | null {
  const bare = specifier.replace(/\?.*$/, '')
  const tries: string[] = []

  if (bare.startsWith('.')) tries.push(resolve(dirname(from), bare))
  else {
    let folder = dirname(from)
    for (;;) {
      tries.push(join(folder, 'node_modules', bare))
      const up = dirname(folder)
      if (up === folder || !folder.startsWith(ROOT.replace(/[\\/]$/, ''))) break
      folder = up
    }
  }

  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

function eagerGraph(entry: string): {
  files: string[]
  packages: Set<string>
  bytes: number
  assets: string[]
  assetBytes: number
} {
  const files: string[] = []
  const packages = new Set<string>()
  const assets: string[] = []
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || files.includes(file)) continue
    files.push(file)

    for (const specifier of asked(file)) {
      if (TEXT.test(specifier)) {
        const text = assetFile(file, specifier)
        if (text && !assets.includes(text)) assets.push(text)
        continue
      }

      if (specifier.endsWith('.css')) continue

      const found = specifier.startsWith('.')
        ? relativeFile(file, specifier)
        : workspaceFile(specifier)
      if (found) queue.push(found)
      else if (!specifier.startsWith('.')) packages.add(specifier)
    }
  }

  const bytes = files.reduce((sum, one) => sum + statSync(one).size, 0)
  const assetBytes = assets.reduce((sum, one) => sum + statSync(one).size, 0)

  return { files, packages, bytes, assets, assetBytes }
}

function everySource(folder: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name)
    if (entry.isDirectory()) out.push(...everySource(full))
    else if (/\.(?:ts|svelte)$/.test(entry.name)) out.push(full)
  }

  return out
}

const graph = eagerGraph(ENTRY)
const names = new Set(graph.files.map((one) => one.replace(/\\/g, '/')))

function holds(tail: string): boolean {
  return [...names].some((one) => one.endsWith(tail))
}

const BUDGET = 1_877_300
const MOST_FILES = 408

const MOST_TEXT = 6_500

describe('what the app evaluates before it draws anything', () => {
  test('is under the budget, in bytes of our own source', () => {
    expect(graph.bytes).toBeLessThan(BUDGET)
  })

  test('and under it in modules, which is what the parsing costs', () => {
    expect(graph.files.length).toBeLessThan(MOST_FILES)
  })

  test('and quotes almost no file into a chunk as text', () => {
    expect(graph.assetBytes, graph.assets.join(', ')).toBeLessThan(MOST_TEXT)
  })

  test('which for the one sheet it does quote is the contrast palette', () => {
    expect(
      graph.assets.map((one) => one.replace(/\\/g, '/').replace(/.*\/packages\//, '')),
    ).toEqual(['themes/src/contrast.css'])
  })

  test.each([
    ['lucide', 'the icon library'],
    ['katex', 'the formula engine'],
    ['katex/contrib/mhchem', 'the chemistry pack'],
    ['node-emoji', 'the emoji table'],
    ['@replit/codemirror-vim', 'the vim keymap'],
    ['@evenrealities/pretext', 'the firmware font metrics'],
    ['mermaid', 'the diagram drawer'],
    ['flowchart.js', "Typora's flowcharts"],
    ['pdfjs-dist', 'the PDF viewer'],
    ['docx', 'the Word writer'],
    ['jszip', 'the zip writer'],
    ['pdf-lib', 'the PDF writer'],
    ['emojilib', "the emoji table's own names"],
    ['unicode-emoji-json', 'the emoji index'],
    ['lucide-static', "Lucide's tags"],
    ['@tauri-apps/api/core', "the crate's own IPC"],
    ['@tauri-apps/plugin-os', "the platform's name, asked for the long way"],
    ['yjs', 'the shared document'],
    ['y-protocols/awareness', 'the awareness protocol'],
    ['@codemirror/language-data', 'the language list'],
    ['turndown', 'the HTML converter'],
    ['turndown-plugin-gfm', "the converter's GFM rules"],
    ['@codemirror/lang-html', 'the HTML grammar'],
    ['@codemirror/lang-css', 'the CSS grammar'],
    ['@codemirror/lang-javascript', 'the JavaScript grammar'],
    ['@lezer/html', "HTML's own"],
    ['@lezer/css', "CSS's own"],
    ['@lezer/javascript', "JavaScript's own"],
    ['@lezer/lr', 'the parser runtime under all three'],
    ['@codemirror/autocomplete', 'the completion popup'],
    ['@codemirror/search', 'the search engine'],
    ['@mtcute/web', 'the Telegram client'],
    ['@whiskeysockets/baileys', 'the WhatsApp client'],
  ])('does not reach %s (%s)', (asked) => {
    expect([...graph.packages]).not.toContain(asked)
  })

  test.each([
    ['/lib/Canvas.svelte', 'the canvas'],
    ['/lib/canvas/ink.ts', "the canvas's ink"],
    ['/lib/Graph.svelte', 'the graph'],
    ['/lib/graph-layout.ts', "the graph's layout"],
    ['/lib/Pages.svelte', 'the pages surface'],
    ['/lib/PagesNavigator.svelte', "the pages surface's thumbnails"],
    ['/lib/web-tab/WebTab.svelte', 'the web tab'],
    ['/lib/SettingsPanel.svelte', 'the settings sheet'],
    ['/lib/wallpaper/held.ts', "the wallpaper's record"],
    ['/lib/wallpaper/sheet.ts', "the wallpaper's sheet, picture and all"],
    ['/lib/wallpaper/wallpaper.svelte.ts', 'the wallpaper store'],
    ['/lib/wallpaper/render.ts', "the wallpaper's canvas"],
    ['/lib/wallpaper/pixels.ts', "the wallpaper's blur"],
    ['/lib/wallpaper/floors.ts', "the wallpaper's scrim"],
    ['/lib/wallpaper/kept.ts', "the wallpaper's copy"],
    ['/themes/src/wallpaper.ts', "the wallpaper's sheet"],
    ['/lib/settings/DefaultBrowser.svelte', 'the default browser row'],
    ['/lib/web-tab/handed.ts', 'the pages other programs hand over'],
    ['/lib/web-tab/permissions.svelte.ts', 'what a site may use'],
    ['/lib/export.ts', 'the exporters'],
    ['/editor/src/vim-mode.ts', "the vim mode's own module"],
    ['/markdown/src/maths.ts', 'the formula engine, dressed'],
    ['/markdown/src/eager.ts', "the Worker's pair of engines"],
    ['/glasses/src/mark.ts', "the glasses' text engine"],
    ['/lib/History.svelte', 'the version list'],
    ['/lib/ShareSheet.svelte', 'the share sheet'],
    ['/lib/PublishSheet.svelte', 'the publish sheet'],
    ['/lib/ImportSheet.svelte', 'the import sheet'],
    ['/lib/IconPicker.svelte', 'the icon picker'],
    ['/lib/Slides.svelte', 'the deck'],
    ['/lib/rooms/room.ts', "a note's room"],
    ['/lib/rooms/plane.ts', "a canvas's room"],
    ['/rooms/src/index.ts', 'the room protocol'],
    ['/editor/src/language-spellings.ts', "the fence languages' vocabulary"],
    ['/editor/src/language-modes.ts', 'the languages nobody ported'],
    ['/editor/src/mermaid.ts', "the diagram fence's tokenizer"],
    ['/editor/src/completing.ts', 'what the popup is built out of'],
    ['/editor/src/finding.ts', 'what a search is made of'],
    ['/markdown/src/from-html.ts', 'the HTML converter'],
    ['/lib/SearchPanel.svelte', 'the Search panel'],
    ['/lib/search/fuzzy.ts', 'the ranking engine'],
    ['/lib/search/suggest.ts', 'the operator values it offers'],
    ['/lib/TagTree.svelte', "the panel's tag tree"],
    ['/lib/FindBar.svelte', 'the find bar'],
    ['/lib/Reading.svelte', 'the reading view'],
    ['/lib/reading/render.ts', 'what it draws with'],
    ['/lib/app-menu.ts', "the app menu's rows"],
    ['/lib/publishing.svelte.ts', "the publish sheet's store"],
    ['/lib/importing.svelte.ts', "the import sheet's store"],
    ['/lib/import/read.ts', 'the readers behind it'],
    ['/lib/recorder/recording.svelte.ts', 'the recorder'],
    ['/lib/recorder/microphone.ts', 'the microphone'],
    ['/lib/recorder/transcript.ts', "the transcript's markdown"],
    ['/lib/RecordingPill.svelte', 'the pill'],
    ['/lib/ai/answering.ts', 'what answers an ai fence'],
    ['/lib/ai/store.svelte.ts', 'the providers'],
    ['/lib/ai/providers.ts', 'what a provider is'],
    ['/lib/ai/complete.ts', 'the request to a model'],
    ['/lib/ai/keys.ts', 'where a key is kept'],
    ['/lib/ai/rewriting.svelte.ts', 'the four rewrites'],
    ['/lib/RewriteSheet.svelte', 'the sheet they are read in'],
    ['/lib/ai/sidebar/ChatPanel.svelte', 'the AI panel'],
    ['/lib/ai/sidebar/chat.svelte.ts', 'its threads'],
    ['/lib/ai/chat/engine.ts', 'the thread engine'],
    ['/lib/ai/chat/threads.ts', 'where threads are kept'],
    ['/lib/ai/retrieve.ts', 'what a question is sent with'],
    ['/lib/Links.svelte', 'the Links panel'],
    ['/lib/HitList.svelte', 'its rows'],
    ['/lib/mobile/handed.ts', 'what the activity hands over'],
    ['/lib/mobile/shared.ts', 'what a share becomes'],
    ['/lib/mobile/widgets.svelte.ts', 'the rows the home screen draws'],
    ['/lib/mobile/dictating.ts', 'the two recognisers'],
    ['/lib/import/apply.ts', 'the import writer'],
    ['/lib/import/names.ts', 'the names it gives'],
    ['/lib/scan-canvas.ts', 'a plane, read into the index'],
    ['/lib/canvas/format.ts', "the app's side of the format"],
    ['/markdown/src/canvas.ts', 'the format itself'],
    ['/markdown/src/canvas-merge.ts', 'the merge two devices settle on'],
    ['/lib/rows/rows.svelte.ts', 'the rows of every space'],
    ['/lib/rows/store.ts', "the rows' store"],
    ['/lib/scan-rows.ts', "the rows' half of a note"],
    ['/bases/src/index.ts', 'the rows engine'],
    ['/markdown/src/pages.ts', 'the pages engine'],
    ['/lib/web-tab/convert.ts', 'the old websites, converted'],
    ['/lib/commands.ts', 'the command list'],
    ['/lib/export/print.ts', 'printing'],
    ['/lib/mobile/dictation.ts', 'dictation'],
    ['/editor/src/lines.ts', 'the line commands'],
    ['/editor/src/grow.ts', 'the selection a step outwards'],
    ['/editor/src/paste-link.ts', 'an address pasted over words'],
    ['/editor/src/block/commands.ts', 'a block duplicated or moved from a key'],
    ['/lib/shortcuts/presets.ts', 'the keyboards'],
    ['/lib/PromptSheet.svelte', 'the question sheet'],
    ['/lib/export/save.ts', 'the writer behind Save as'],
    ['/lib/pdf/papers.ts', "the papers' words"],
    ['/lib/editor-menu.ts', "the editor's menu"],
    ['/editor/src/menu.ts', 'what it asks of the editor'],
    ['/lib/theme-picker/picking.svelte.ts', 'the theme picker'],
    ['/lib/theme-picker/ThemePicker.svelte', 'its sheet'],
    ['/lib/theme-picker/looks.ts', "its cards' colours"],
    ['/lib/schemes.ts', 'the names of the three schemes, which only the pickers say'],
    ['/lib/ContextMenu.svelte', 'the right-click menu'],
    ['/lib/FormatBar.svelte', 'the bar over a selection'],
    ['/lib/SignIn.svelte', 'the sign-in sheet'],
    ['/lib/JoinSheet.svelte', 'the join sheet'],
    ['/lib/drawer-follow.ts', "a drawer's drag"],
    ['/lib/swipe.ts', "the drag's arithmetic"],
    ['/editor/src/block/commands.ts', "what a block's menu does"],
    ['/editor/src/run/run.ts', "the Run button's sandbox"],
    ['/editor/src/run/panel.ts', 'what it prints into'],
    ['/editor/src/wikilink/complete.ts', 'the rows `[[` offers'],
    ['/lib/search/match.ts', 'the matcher'],
    ['/markdown/src/slides.ts', "a deck's renderer"],
    ['/lib/preview-card.ts', 'the editor in a link card'],
    ['/lib/reading/drawn.ts', 'a paper or a plane drawn in a note'],
    ['/lib/query-block.ts', "a query fence's rows"],
    ['/lib/note-cover.ts', "a note's cover, written"],
    ['/lib/themes/store.svelte.ts', "the theme gallery's store"],
    ['/lib/themes/registry.ts', 'the theme catalogue'],
    ['/lib/themes/validate.ts', 'the theme reviewer'],
    ['/lib/api/routes.ts', "the service's calls"],
    ['/lib/icon-sets.ts', 'the list of icon sets'],
    ['/lib/recorder/commands.ts', 'the row that wakes the recorder'],
    ['/lib/recorder/container.ts', 'whether this device can record at all'],
    ['/lib/first-screen/keep.svelte.ts', "what keeps a note's first screen"],
    ['/lib/search/warm.svelte.ts', "the search's hold on the space"],
    ['/markdown/src/index.ts', 'the renderer'],
    ['/lib/chats/providers/telegram-client.ts', "the Telegram client's door"],
    ['/lib/chats/providers/whatsapp-client.ts', "the WhatsApp client's door"],
  ])('nor %s (%s)', (tail) => {
    expect(holds(tail), tail).toBe(false)
  })

  test.each([
    ['/src/App.svelte', 'the app'],
    ['/lib/Pane.svelte', 'a pane'],
    ['/lib/Editor.svelte', 'the editor'],
    ['/lib/Tree.svelte', 'the file list'],
    ['/editor/src/editor.ts', "the editor's own state"],
    ['/markdown/src/breaks.ts', 'the line-break switch the renderer reads'],
    ['/markdown/src/engines.ts', 'the holder the two heavy libraries arrive in'],
    ['/lib/surfaces.svelte.ts', 'the doors the sheets come through'],
    ['/lib/rooms.svelte.ts', 'the store that joins a room'],
    ['/editor/src/languages.ts', "the fence languages' door"],
    ['/editor/src/paste.ts', 'the paste that asks for the converter'],
    ['/editor/src/completion.ts', 'the door the popup comes through'],
    ['/editor/src/find.ts', 'the door a search comes through, and the bar’s own seam'],
    ['/editor/src/open-views.ts', 'the editors a late arrival has to reach'],
    ['/lib/menu-item.ts', 'what a menu row is, which the app menu walks without it'],
    ['/lib/ai/ask.ts', 'the stub behind an ai fence’s glyph'],
    ['/lib/mobile/bridge.ts', 'whether there is an activity at all'],
    ['/lib/shortcuts/preset-ids.ts', 'the names of the keyboards'],
    ['/lib/drawer.svelte.ts', 'the drawers as the markup reads them'],
    ['/editor/src/run/door.ts', 'the door the Run button knocks on'],
    ['/editor/src/wikilink/block-namer.ts', 'the facet every editor is built with'],
    ['/markdown/src/slide-breaks.ts', 'whether a note is a deck'],
  ])('while %s (%s) is', (tail) => {
    expect(holds(tail), tail).toBe(true)
  })

  test('and no catalogue of any language', () => {
    const catalogues = readdirSync(fileURLToPath(new URL('../src/locales/', import.meta.url)))
    expect(catalogues.length).toBeGreaterThan(30)

    for (const one of catalogues) {
      expect(holds(`/locales/${one}`), one).toBe(false)
    }
  })

  test('and nothing of the agents', () => {
    expect([...names].filter((one) => one.includes('/lib/agents/'))).toEqual([])
    expect(holds('/lib/agent-marks.svelte.ts')).toBe(true)
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

  const OVERRIDE = '@codemirror/lang-markdown>@codemirror/lang-html'
  const DOOR = join(ROOT, 'packages/lang-html/src/index.ts')

  test('and the HTML grammar comes through nib’s own door, as the manifest says', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }

    expect(manifest.pnpm?.overrides?.[OVERRIDE]).toBe('workspace:@orden/lang-html@*')
    expect(existsSync(DOOR)).toBe(true)
  })

  const POPUP = '@codemirror/lang-markdown>@codemirror/autocomplete'
  const POPUP_DOOR = join(ROOT, 'packages/autocomplete/src/index.ts')

  test('and the completion library the same way, said in the same manifest', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }

    expect(manifest.pnpm?.overrides?.[POPUP]).toBe('workspace:@orden/autocomplete@*')
    expect(existsSync(POPUP_DOOR)).toBe(true)
    expect(asked(POPUP_DOOR)).not.toContain('@codemirror/autocomplete')
  })

  test('and the door asks for the grammar rather than importing it', () => {
    expect(asked(DOOR)).not.toContain('@codemirror/lang-html')
    expect(readFileSync(DOOR, 'utf8')).toContain("import('@codemirror/lang-html')")
  })

  const CRATE = join(ROOT, 'apps/desktop/src/lib/native.ts')

  test('and the crate comes through nib’s own door', () => {
    expect(existsSync(CRATE)).toBe(true)
    expect(readFileSync(CRATE, 'utf8')).toContain("from '@tauri-apps/api/core'")
  })

  test('which nothing asks for dynamically, since nothing could move it', () => {
    const named = everySource(join(ROOT, 'apps/desktop/src')).filter((one) =>
      /import\(\s*['"]@tauri-apps\/api\/core['"]/.test(
        readFileSync(one, 'utf8').replace(COMMENTS, (_whole, head?: string) => head ?? ''),
      ),
    )

    expect(named).toEqual([])
  })
})

describe('what reading a note fetches', () => {
  const READING = join(import.meta.dirname, '../src/lib/reading/render.ts')
  const SLIDES = join(import.meta.dirname, '../src/lib/slides/render.ts')
  const EXPORTER = join(import.meta.dirname, '../src/lib/export.ts')
  const RENDERER = join(import.meta.dirname, '../../../packages/markdown/src/index.ts')

  function waitedFor(surface: string): string {
    const source = readFileSync(surface, 'utf8')
    const found = /prepareFences[^}]*\}\s*=\s*await import\('([^']+)'\)/.exec(source)
    expect(found, 'the surface no longer awaits prepareFences').not.toBeNull()

    const file = relativeFile(surface, found?.[1] ?? '')
    expect(file, `nothing at ${found?.[1]}`).not.toBeNull()

    return file ?? ''
  }

  const already = new Set(graph.files)
  for (const one of eagerGraph(RENDERER).files) already.add(one)

  function newBytes(files: readonly string[]): number {
    return files
      .filter((one) => !already.has(one))
      .reduce((sum, one) => sum + statSync(one).size, 0)
  }

  const exporter = newBytes(eagerGraph(EXPORTER).files)

  for (const [what, surface] of [
    ['the reading view', READING],
    ['the slides', SLIDES],
  ] as const) {
    test(`${what} does not fetch the exporter to render a note`, () => {
      const ahead = eagerGraph(waitedFor(surface))
      const reached = ahead.files.map((one) => one.replace(/\\/g, '/'))

      expect(reached.filter((one) => one.endsWith('/themes/src/raw.ts'))).toEqual([])
      expect(ahead.assets, 'stylesheets quoted into the surface').toEqual([])

      for (const heavy of [
        '/export.ts',
        '/export/save.ts',
        '/export/pictures.ts',
        '/export/document.ts',
        '/export-formats.ts',
        '/math-fonts.ts',
        '/page-setup.ts',
      ]) {
        expect(
          reached.filter((one) => one.endsWith(heavy)),
          heavy,
        ).toEqual([])
      }

      expect(newBytes(ahead.files)).toBeLessThan(exporter / 2)
    })
  }
})
