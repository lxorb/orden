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
  'downloads',
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
 *
 *  The code raised on 2026-11-04, to 5,814,600, for #1081: whether a row of the file
 *  list stands open asked in one place, of the rows drawn (`standsOpen` and `anyOpen`
 *  in tree-flat.ts), and the folders remembered open kept clean of the ones that went
 *  (`keepOpen` in workspace/device.svelte.ts). Measured 5,814,220.
 *
 *  The code raised on 2026-11-04, to 5,819,500, and the catalogues to 956,700, for
 *  #1087: Send feedback confirms a report with its page and carries pictures
 *  (feedback-pictures.ts, FeedbackSheet.svelte), in nine strings in every language.
 *  Measured 5,819,167 and 956,373.
 *
 *  The code raised on 2026-11-04, to 5,825,400, for #1065: a pull down past the top
 *  reloads where the reader is, its mark turning until done (pull.svelte.ts, refresh.ts,
 *  PullMark.svelte). Measured 5,825,175.
 *
 *  The code raised on 2026-11-04, to 5,842,300, for #1075: the live preview over a
 *  formula being written (maths-preview.ts in the editor), a chunk of its own fetched
 *  with a note's first dollar, which splits the formula's drawing out of the chunks it
 *  shared. Measured 5,842,228.
 *
 *  The code raised on 2026-11-04, to 5,845,900, and the catalogues to 963,000, for #1088:
 *  the window's corners as a setting beside the theme (corners.ts) and the Tab preview
 *  delay (tab-strip/preview-delay.svelte.ts), with their six sentences in every
 *  language. Measured 5,845,725 and 962,864.
 *
 *  The code raised on 2026-11-04, to 5,846,200, and the catalogues to 964,400, for
 *  #1089: every AI chat in one state moved by one machine (ai/session-state.ts), the
 *  rows that show it with their model's logo, Pin and Archive (ai/sidebar/ChatRow.svelte),
 *  the slide to the next chat (ai/sidebar/slide.ts) and the question before a costly
 *  switch of model (ai/switch-cost.ts), in nine strings in every language. Measured
 *  5,846,057 and 964,246.
 *
 *  The code raised on 2026-11-04, to 5,848,600, for #1077: signing in gives the untouched
 *  default space way to the account's own, decided in one place (seed-space.ts, and the
 *  plan's `discard` in space-plan.ts). Measured 5,848,312.
 *
 *  The code raised on 2026-11-04, to 5,848,800, for #1067: a popup fetched through a
 *  door plays its way out and turns round where it is when pressed again (Door.svelte,
 *  `letGo` in slide.ts). Measured 5,848,628.
 *
 *  The code raised on 2026-11-04, to 5,849,300, for #1055: an online terminal held by
 *  one device at a time, its card saying who holds it with Take over (arrival.svelte.ts),
 *  and its file a row of the list. Measured 5,849,083.
 *
 *  The code raised on 2026-11-04, to 5,852,200, for #1051: the Essentials' Alt letters
 *  (tab-strip/letters.ts, tab-strip/letters.svelte.ts) and a double click that keeps an
 *  Essential as a tab. Measured 5,852,018.
 *
 *  The code raised on 2026-11-04, to 5,853,500, for #1039: a second press on what
 *  opened a menu or a popover closes it (overlays.ts, menu.svelte.ts). Measured
 *  5,853,362.
 *
 *  The code raised on 2026-11-04, to 5,859,300, for #1056: the value box and column every
 *  setting's value is drawn in (`.nib-field.is-value`, `--setting-value` in base.css),
 *  which the stylesheet's raw text carries for export. Measured 5,859,138.
 *
 *  The code raised on 2026-11-04, to 5,860,400, for #1042: a note that says nothing yet
 *  wears the empty page, and Lucide's folder where it holds notes, read on the scan the
 *  index makes (`saysNothing` in scan-note.ts) and decided in `sourceMark`
 *  (chosen-icon.ts). Measured 5,860,304.
 *
 *  The code raised on 2026-11-04, to 5,861,700, for #1040: a new tab nothing was done
 *  with goes once it is left (workspace.svelte.ts, workspace/blank-tabs.svelte.ts).
 *  Measured 5,861,488.
 *
 *  The code raised on 2026-11-04, to 5,862,600, for #1051: an essential let go of on
 *  a strip of tabs kept as a tab where it landed (tab-strip/essential-drop.ts, Tabs.svelte).
 *  Measured 5,862,455.
 *
 *  The code raised on 2026-11-04, to 5,865,000, for #1034: the shut file list comes out
 *  over the note when the pointer rests at the window's edge (edge-peek.svelte.ts,
 *  Sidebar.svelte). Measured 5,864,844.
 *
 *  The code raised on 2026-11-04, to 5,865,700, for #1059: the palette finds a website
 *  by its address as well as its name (kinds.ts), and the index says which websites the
 *  space holds (link-index.svelte.ts). Measured 5,865,507.
 *
 *  The code raised on 2026-11-04, to 5,866,200, for #1046: Todos, one view of a space's
 *  tasks with Todoist's Display menu over it - its groupings, sortings and filters and
 *  the count of what differs (display.ts, DisplayBuilder.svelte), a space's own kept
 *  layout (kept-views.ts) and GitHub's column heads (BoardHead.svelte). Measured
 *  5,865,852.
 *
 *  The code raised on 2026-11-04, to 5,866,700, for #1032: the right side shut whole by its
 *  one button, with the scratchpad one of its tabs (workspace.svelte.ts, Sidebar.svelte).
 *  Measured 5,866,534.
 *
 *  The code raised on 2026-11-04, to 5,868,500, for #331: the tab overview's cells, round
 *  and holding every window on every frame (overview/membrane.ts, overview/Cells.svelte).
 *  Measured 5,868,335.
 *
 *  The catalogues raised on 2026-11-04, to 964,800, for #1098: Reset to site icon, the row
 *  that gives a web note back the site's own mark, in every catalogue. Measured 964,739.
 *
 *  The code raised on 2026-11-04, to 5,869,600, and the catalogues to 965,200, for
 *  #331: a window of the tab overview lying wherever it was let go, the others pushed out
 *  of its way, and Tidy up (overview/free.ts) in every language. Measured 5,869,405 and
 *  965,023.
 *
 *  The code raised on 2026-11-04, to 5,870,900, for #1055: an online terminal not saved,
 *  which the plugin never opens, kept as its `.term` when it is (workspace/placing.ts,
 *  drafts.ts). Measured 5,870,576.
 *
 *  The code raised on 2026-11-04, to 5,872,500, for #1066 again: the file list's button
 *  said and not shown where a swipe from the edge pulls the list out, and the one hint
 *  about the swipe (Titlebar.svelte, SidebarToggle.svelte, hints.svelte.ts), put back
 *  after the #1056 rebase dropped them. Measured 5,872,382.
 *
 *  The code raised on 2026-11-04, to 5,873,000, for #1100: Send feedback's bug back in
 *  the sidebar's foot (SidebarFoot.svelte). Measured 5,872,846.
 *
 *  The code raised on 2026-11-04, to 5,875,200, for #1057: the shapes every settings
 *  button is drawn with (`.nib-tag`, `.nib-setting-mark`, `.nib-glyph.is-danger`, a
 *  busy `.nib-chip` in base.css), which the stylesheet's raw text carries for export.
 *  Measured 5,875,013.
 *
 *  The code raised on 2026-11-04, to 5,875,900, for #331: the cross on a window of the tab overview that
 *  closes its tab (overview/Overview.svelte).
 *  Measured 5,875,759.
 *
 *  The code raised on 2026-11-04, to 5,880,800, for #331: the pictures the tab overview keeps of windows,
 *  taken as each leaves the screen (overview/faces.ts, overview/faces.svelte.ts).
 *  Measured 5,880,642.
 *
 *  The code raised on 2026-11-04, to 5,882,900, for #331: the tab overview handing over to the app and
 *  back with no frame of difference (overview/Overview.svelte, overview/mirror.ts).
 *  Measured 5,882,737.
 *
 *  The code raised on 2026-11-04, to 5,884,400, for #331: each kind's way of drawing its window in the
 *  tab overview (overview/previews.ts, workspace/tab-kinds.ts).
 *  Measured 5,884,223.
 *
 *  The catalogues raised on 2026-11-04, to 967,400, for #1041: the switch that shows every
 *  tab but the one in front as its icon, with its hint, in every catalogue
 *  (general-pane.ts). Measured 967,294.
 *
 *  The code raised on 2026-11-04, to 5,892,500, and the catalogues to 969,500, for #1054
 *  and #1116: the icon picker's Web icons - the account's sites, held on the device and
 *  drawn as pictures, in every catalogue - and a cell's marks on its own box
 *  (web-tab/site-icons.svelte.ts, IconPicker.svelte, Icon.svelte). Measured 5,891,756
 *  and 968,905.
 *
 *  The code raised on 2026-11-04, to 5,894,100, for #1063: an application as a kind of
 *  file and tab in developer mode, which the plugin never opens. Its words fit in the
 *  catalogues' room. Measured 5,893,553.
 *
 *  The code raised on 2026-11-04, to 5,894,600, for #1068: a bookmark keeps the id of
 *  what it points at, and is found by it (workspace/bookmarks.svelte.ts,
 *  workspace/entry-ids.ts). Measured 5,894,413.
 *
 *  The code raised on 2026-11-04, to 5,897,400, and the catalogues to 973,000, for #1033:
 *  Alt+H, J, K and L between the panes (pane-moves.ts, `paneToward` in
 *  workspace/pane-tree.ts), and their four names and the pointer's switch in every
 *  language. Measured 5,897,207 and 972,863.
 *
 *  The code raised on 2026-11-04, to 5,903,500, for #1120: the editor's properties
 *  strip and a footnote's card and jump, which the plugin's notes draw too. Measured
 *  5,902,056.
 *
 *  The styles raised on 2026-11-04, to 290,400, for #331: the tab overview's close button
 *  as the app's quiet grey one with its cross red, its hover and its press
 *  (overview/Overview.svelte). Measured 290,153.
 *
 *  The styles raised on 2026-11-04, to 290,700, for #331: the tab overview happens in the
 *  window, its sidebars sliding away under its spring and its canvas a clear scrim under
 *  the bar (overview/Overview.svelte). Measured 290,456.
 *
 *  The code raised on 2026-11-04, to 5,904,800, for #331: each pane shrinks where it is
 *  into its own window in the tab overview (`paneDrawn` in overview/flight.ts, the layer
 *  under the panes in overview/Overview.svelte). Measured 5,904,611.
 *
 *  The styles raised on 2026-11-04, to 290,800, for #1063: a chooser's row wearing an
 *  installed application's own icon, in the box a mark is in (PromptSheet.svelte).
 *  Measured 290,744.
 */
export const BUDGETS: Record<Part, number> = {
  code: 5_904_800,
  catalogues: 973_000,
  styles: 290_800,
  fonts: 260_000,
  pages: 40_000,
}
