/** What may go into the Even Realities plugin, and how much of each.
 *
 *  The plugin is the app with the desktop left out, and the desktop grows every week.
 *  Leaving something out used to be found out at the 8 MiB ceiling, by whichever
 *  change happened to cross it, a long way from the change that brought the weight
 *  in. So the package is held to a list instead: every library, every package of
 *  ours and every folder of the app's that is in it is named here, and anything new
 *  fails src/lib/even/bundle.test.ts by name, in the change that brought it.
 *
 *  A new entry is a decision, not a fix for a red test. If the phone or the glasses
 *  need it, name it here. If not, leave it out where it comes in: a library in
 *  `LEFT_OUT` in vite.even.config.ts, a module of ours by a twin beside it
 *  (`x.even.ts`, see `twinOf` there), and only as a last resort a branch on
 *  `__EVEN_PLUGIN__`.
 *
 *  And the weight of each part of the package, in bytes as staged, with room to grow
 *  that adds up to well under the ceiling: a part that outgrows its budget says which
 *  part grew rather than that the package did. */

/** Libraries, by package name. */
export const LIBRARIES = [
  // The interface and its icons
  'svelte',
  'clsx',
  'lucide',
  'perfect-freehand',
  'uqr',
  // The glasses: the bridge, the firmware's metrics, the emoji it cannot draw
  '@evenrealities/even_hub_sdk',
  '@evenrealities/pretext',
  'node-emoji',
  'emojilib',
  'char-regex',
  'skin-tone',
  'unicode-emoji-modifier-base',
  // A note: markdown, its properties, its maths, pasting into it
  'marked',
  'yaml',
  'katex',
  'turndown',
  'turndown-plugin-gfm',
  '@sindresorhus/is',
  // Sync and rooms
  'yjs',
  'y-protocols',
  'lib0',
  // The calls a desktop answers, which the web build answers itself
  '@tauri-apps/api',
  '@tauri-apps/plugin-dialog',
  '@tauri-apps/plugin-opener',
  '@tauri-apps/plugin-process',
  // The editor
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
  '@marijn/find-cluster-break',
  'crelt',
  'style-mod',
  'w3c-keyname',
  '@replit/codemirror-vim',
  '@replit/codemirror-vim-core',
  // A fence's colours, each fetched when a fence names its language
  '@codemirror/language-data',
  '@codemirror/legacy-modes',
  '@codemirror/lang-angular',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-jinja',
  '@codemirror/lang-json',
  '@codemirror/lang-less',
  '@codemirror/lang-liquid',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sass',
  '@codemirror/lang-sql',
  '@codemirror/lang-vue',
  '@codemirror/lang-wast',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
  '@lezer/cpp',
  '@lezer/css',
  '@lezer/go',
  '@lezer/html',
  '@lezer/java',
  '@lezer/javascript',
  '@lezer/json',
  '@lezer/php',
  '@lezer/python',
  '@lezer/rust',
  '@lezer/sass',
  '@lezer/xml',
  '@lezer/yaml',
  '@replit/codemirror-lang-nix',
  '@replit/codemirror-lang-solidity',
  '@replit/codemirror-lang-svelte',
  'codemirror-lang-elixir',
  'codemirror-lang-hcl',
  'lezer-elixir',
]

/** Our own packages, by their folder under packages/. */
export const PACKAGES = [
  'autocomplete',
  'bases',
  'editor',
  'glasses',
  'lang-html',
  'markdown',
  'rooms',
  'sync-core',
  'themes',
]

/** The app's own folders under src/lib. The files at the top of src/lib are the shell
 *  and are not listed one by one; the budget for code is what holds them. */
export const APP_FOLDERS = [
  'agents',
  'ai',
  'api',
  'automation',
  'back-swipe',
  'canvas',
  'even',
  'export',
  'foreign',
  'glass',
  'import',
  'mobile',
  'online',
  'overview',
  'pages',
  'palette',
  'pdf',
  'properties',
  'quick-add',
  'reading',
  'recorder',
  'reminders',
  'remote',
  'rooms',
  'rows',
  'save-place',
  'scratchpad',
  'search',
  'settings',
  'shortcuts',
  'slides',
  'sync',
  'sync2',
  'tab-fill',
  'tab-strip',
  'terminal',
  'theme-picker',
  'themes',
  'views',
  'wallpaper',
  'web',
  'web-tab',
  'workspace',
]

/** Where a module of the package comes from, as the lists above name it, or null for
 *  what the bundler and this build write themselves and for the app's own top level. */
export function sourceOf(module: string): string | null {
  const path = module.replace(/\\/g, '/')
  if (path.startsWith('\0')) return null

  const library = path.lastIndexOf('node_modules/')
  if (library >= 0) {
    const [scope = '', name = ''] = path.slice(library + 'node_modules/'.length).split('/')
    return `library ${scope.startsWith('@') ? `${scope}/${name}` : scope}`
  }

  const ours = /^packages\/([^/]+)\//.exec(path)
  if (ours) return `package ${ours[1]}`

  const folder = /^apps\/desktop\/src\/lib\/([^/?]+)\//.exec(path)
  return folder ? `folder ${folder[1]}` : null
}

/** Each part of the staged package, by what its files are. */
export type Part = 'catalogues' | 'code' | 'fonts' | 'styles' | 'pages'

/** The part a staged file belongs to. `catalogue` says whether a script is one of the
 *  interface's catalogues or the English they share. */
export function partOf(file: string, catalogue: boolean): Part {
  if (file.endsWith('.js')) return catalogue ? 'catalogues' : 'code'
  if (file.endsWith('.css')) return 'styles'
  if (/\.(woff2?|ttf)$/.test(file)) return 'fonts'
  return 'pages'
}

/** Bytes each part may weigh, as staged. Measured on 2026-10-07 at 5,297,926 for the
 *  code, 762,886 for the catalogues, 266,816 for the styles, 256,168 for the fonts and
 *  33,555 for the pages and the icon. The budgets add up to 7,270,000, so 1.07 MiB of
 *  the 8 MiB ceiling is out of every part's reach without a change to this table.
 *
 *  The code raised on 2026-10-24, to 5,700,000, for the second bug burn-down landed
 *  together (#681 to #948). Measured 5,654,763.
 *
 *  Raised on 2026-10-27, to 5,702,000, for B561 and B562: a file the account has no room
 *  for waits on its own while the rest of the space syncs (sync2/files.ts, pass.ts).
 *  Measured 5,700,168.
 *
 *  Raised on 2026-10-27, to 5,730,000, once for the fourth bug burn-down's pending
 *  fixes, so each of them need not raise it. Measured 5,700,028 with main as of this
 *  raise.
 *
 *  Raised on 2026-10-27, to 5,732,000, for #781: what a canvas holds that Orden does not
 *  read is fingerprinted and counted in generations, so a merge keeps the version another
 *  app changed (canvas-extras.ts, in the plugin through the canvas it opens). Measured
 *  5,730,560, from 5,728,470 at d6bbe05c4.
 *
 *  The catalogues' raised on 2026-10-24, from 850,000 to 950,000, for #768: every
 *  setting the plugin's own Settings shows says what it does behind a `?`, and those
 *  sentences are rows the plugin asks for, in each of the 24 catalogues it ships.
 *  Measured 922,538, from 779,615 at 7a57b7518. *
 *  The code raised on 2026-10-28, to 5,733,000, for #523: the file list, which the
 *  plugin carries, is a tree to a screen reader and hands the keyboard on from a row
 *  deleted under it (Tree.svelte). Measured 5,732,608, from 5,731,862 at 0168bd709.
 *
 *  The code raised on 2026-11-01, to 5,739,000, for the fourth bug burn-down's fixes
 *  merged into unstable at 9163eeb16: its raises were measured without them. Measured
 *  5,738,198.
 *
 *  The code raised on 2026-11-02, to 5,740,500, for #613: a move sync makes waits for
 *  the write in the air (`holdingWrites` in saving.svelte.ts). Measured 5,740,275.
 *
 *  The code raised on 2026-11-02, to 5,742,000, for #790, #791 and #397: what the plugin
 *  carries of a page whose process died, the zoom rows and a host's two spellings. The rule
 *  for reading a name (web-tab/idn.ts) is left out. Measured 5,741,223.
 *
 *  The code raised on 2026-11-02, to 5,740,000, for #680: the interface's zoom in
 *  modes.svelte.ts. Measured 5,739,049.
 *
 *  The code raised on 2026-11-02, to 5,748,000, for the space's AGENTS.md shown as a
 *  field: the name refused on the glasses' own file list too, and the file left off it.
 *  Measured 5,747,277.
 *
 *  The code raised on 2026-11-02, to 5,767,900, for the open bug round's branches merged
 *  together on claude/bugs-2026-11: each raise above was measured without the others.
 *  Measured 5,767,345.
 *
 *  The code raised on 2026-11-02, to 5,739,500, for #523: a notice's words go through the
 *  one live region and the notices row is a region F6 walks to (UndoToast.svelte,
 *  said.svelte.ts, focus.ts). Measured 5,739,412, from 5,739,030 at ff4c0315c, which was
 *  over already.
 *
 *  The code raised on 2026-11-02, to 5,739,900, for #523: a property's key is a button the
 *  keyboard renames and opens the row's menu from (PropertiesPanel.svelte). Measured
 *  5,739,841.
 *
 *  The code raised on 2026-11-02, to 5,740,000, for #523: a sidebar opened from its toggle
 *  by a key takes the keyboard into it (`enterSide` in focus.ts). Measured 5,739,967.
 *
 *  The code raised on 2026-11-02, to 5,740,100, for #523: a property's key tells a key's
 *  press from a click, so the pointer keeps renaming it with a double click
 *  (PropertiesPanel.svelte). Measured 5,740,025.
 *
 *  The code raised on 2026-11-02, to 5,741,000, for #1036: a web page taking the keyboard
 *  is the app's own page letting go of whatever it had focused, told by the crate as well
 *  as by the window's blur (keyboard-home.ts). Measured 5,740,924.
 *
 *  The code raised on 2026-11-03, to 5,769,000, for unstable's #523 and #1036 fixes merged
 *  into claude/bugs-2026-11: the two branches' raises above were measured without each
 *  other, and the fixes for one behaviour made one. Measured 5,768,860.
 *
 *  The code raised on 2026-11-03, to 5,743,700, for #1044: the space's inbox is a hidden
 *  note of Orden's own, which the rows read with the space, sync carries and merges as
 *  every task of both (packages/bases/src/inbox.ts). Measured 5,743,620.
 *
 *  The code raised on 2026-11-03, to 5,743,800, for #1052: the `?` after a setting's name
 *  sits on the name's letters as a word of it, glued to the last word, rather than in a
 *  flex row beside it (Hint.svelte). Measured 5,743,715.
 *
 *  The code raised on 2026-11-03, to 5,743,900, for #1060: the sliver the window is
 *  dragged by is drawn by the strip in the titlebar, ahead of its own buttons, rather
 *  than by the bar after them (Tabs.svelte, Titlebar.svelte). Measured 5,743,874.
 *
 *  The code raised on 2026-11-03, to 5,744,300, for #1064: the ✦ tab wears a dot while an
 *  AI chat has an answer not yet seen (Sidebar.svelte, ai/UnreadDot.svelte,
 *  ai/unread.svelte.ts). Measured 5,744,218.
 *
 *  The code raised on 2026-11-03, to 5,746,600, for #1064: the dot is read from the
 *  chats' heads at launch, before the AI panel is opened (`lookAtLaunch` in
 *  ai/unread.svelte.ts). Measured 5,746,478.
 *
 *  The code raised on 2026-11-04, to 5,747,000, for #1076: what floats in a note's
 *  corners is drawn by the focused pane inside its own box (pane-corners.svelte.ts).
 *  Measured 5,746,806.
 *
 *  The code raised on 2026-11-04, to 5,747,600, for #1079: a pane that loses its tab
 *  in front comes back to the one used there last (workspace/recency.ts), and keeps
 *  that order through a restart. Measured 5,747,488.
 *
 *  The code raised on 2026-11-03, to 5,775,600, for unstable's #1044 to #1079 merged into
 *  claude/bugs-2026-11: the two branches' raises above were measured without each other,
 *  and the sum of their growth is what came. Measured 5,775,432.
 *
 *  The code raised on 2026-11-03, to 5,777,800, for #1071: the icon picker's emoji and
 *  coloured drawings are one tab, the sets merged into one collection
 *  (`mergeSets` in icon-sets.ts); the drawings' places among the emoji stay out
 *  (flat-colour-places.even.ts). Measured 5,777,606.
 *
 *  The code raised on 2026-11-04, to 5,778,300, for #1070: an agent opens and shows
 *  everything behind the reader through one door (agents/workspace/reader-view.ts), and a
 *  tab it opened wears its spark until looked at. Measured 5,778,101.
 *
 *  The code raised on 2026-11-03, to 5,792,500, for #331: every tab as a window on a
 *  canvas, Alt Alt (overview/), which takes the place of the palette's tab cards.
 *  Measured 5,792,326.
 *
 *  The code raised on 2026-11-03, to 5,794,900, for #331: a window of the overview
 *  dragged to another place in its strip or into another pane (overview/drag.ts), and
 *  Alt Alt turning it back at any moment. Measured 5,794,727.
 *
 *  The code raised on 2026-11-04, to 5,795,200, for #676: a PDF's mark is a page with
 *  "PDF" written under it, and what a file was made from is decided in one place
 *  (`typeMark` in file-mark.ts, `sourceMark` in chosen-icon.ts). Measured 5,795,057.
 *
 *  The code raised on 2026-11-04, to 5,795,500, for #1090: the window's door to the
 *  notice a Mac's AI keys are typed again by, which the plugin never opens
 *  (surfaces.svelte.ts). Measured 5,795,317.
 *
 *  The code raised on 2026-11-03, to 5,800,000, for #331: the overview's one canvas,
 *  each space's place on it kept (overview/places.svelte.ts), moved and zoomed by the
 *  wheel, a touchpad and two fingers (overview/camera.ts), and a window dropped against a
 *  side making a pane there. Measured 5,799,795.
 *
 *  The code raised on 2026-11-04, to 5,801,700, for #1082: the brands' tab and a
 *  website's brand read off its address (icon-sets.ts, `siteBrand` in icons.ts); the
 *  logos and their names stay out (vite.even.config.ts, brand-names.even.ts). Measured
 *  5,801,561.
 *
 *  The code raised on 2026-11-04, to 5,813,700, for #331: All spaces, every space's
 *  windows in a living membrane on the overview's canvas (overview/membrane.ts,
 *  Cells.svelte), and a window plopped from one cell into another moved to that space
 *  (overview/cells.ts). Measured 5,813,519.
 *
 *  The code raised on 2026-11-04, to 5,813,900, for #1074: a web tab's bar saying a
 *  window the page opened on its own was blocked, with its Open (WebTab.svelte, and the
 *  words in every catalogue). Measured 5,813,707.
 */
export const BUDGETS: Record<Part, number> = {
  code: 5_813_900,
  catalogues: 950_000,
  styles: 290_000,
  fonts: 260_000,
  pages: 40_000,
}
