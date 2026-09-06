import {
  type BindingSpec,
  defaultKeyFor,
  type EditorView,
  imageBindings,
  type KeyOverrides,
  nibBindings,
  setShortcutKeys,
  standardBindings,
  tableBindings,
} from '@nib/editor'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { t } from './i18n.svelte'
import {
  currentPlatform,
  matchesCombination,
  parseCombination,
  type Platform,
  sameCombination,
  showCombination,
} from './keys'
import { modes } from './modes.svelte'
import { openFile } from './open-file'
import { settings } from './settings.svelte'
import { invoke, isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

const STORAGE_KEY = 'nib:shortcuts'

/** How many entries the account will carry, and how long a key may be. The
 *  same numbers the server enforces; see services/sync/src/settings.ts. */
const MOST_OVERRIDES = 200

/** Where an entry sits in the list. The first five are the app's own menus,
 *  so a reader looking for Bold looks under Format either way. */
export type Category = 'file' | 'edit' | 'format' | 'paragraph' | 'view' | 'table' | 'picture' | 'fixed'

export const CATEGORIES: { id: Category; label: () => string }[] = [
  { id: 'file', label: () => t('File') },
  { id: 'edit', label: () => t('Edit') },
  { id: 'format', label: () => t('Format') },
  { id: 'paragraph', label: () => t('Paragraph') },
  { id: 'view', label: () => t('View') },
  { id: 'table', label: () => t('Tables') },
  { id: 'picture', label: () => t('Pictures') },
  { id: 'fixed', label: () => t('Fixed keys') },
]

/** What an app-level shortcut needs that only the running app has: the view
 *  on screen, and the two things that live in App.svelte's own state. */
export interface AppContext {
  view?: EditorView
  palette(): void
  fullscreen(): void
}

/** One shortcut, whole: what it is called, where it belongs, which key it
 *  starts on, and how it runs.
 *
 *  `scope` is the difference that matters for conflicts. An `app` binding is
 *  read off the window and fires wherever the focus is, so it shadows an
 *  `editor` binding on the same key rather than sharing it. A `fixed` one
 *  cannot be changed at all and is here to be seen: a key that is spoken for
 *  and a reason why, rather than a gap in the list. */
export interface Shortcut {
  id: string
  label: () => string
  category: Category
  scope: 'app' | 'editor' | 'fixed'
  key: string | null
  mac?: string | null
  win?: string | null
  linux?: string | null
  /** Gives way when what it is looking for is not there, so it can share a
   *  key without being in anyone's way. See BindingSpec in the editor. */
  contextual?: boolean
  /** A second key for a command that already has one. */
  alias?: boolean
  /** Why it cannot be changed. Present only on the fixed ones. */
  why?: () => string
  run?: (context: AppContext) => void
}

/** The other half of every binding the editor package declares: what it is
 *  called, and which group of the list it belongs to. The keys and the
 *  commands live over there; the words live here, where the dictionaries
 *  are. An id in one and not the other fails shortcuts.test.ts. */
const EDITOR_ENTRIES: Record<string, [Category, () => string]> = {
  'format.bold': ['format', () => t('Bold')],
  'format.italic': ['format', () => t('Italic')],
  'format.underline': ['format', () => t('Underline')],
  'format.code': ['format', () => t('Code')],
  'format.strikethrough': ['format', () => t('Strikethrough')],
  'format.highlight': ['format', () => t('Highlight')],
  'format.link': ['format', () => t('Link')],
  'format.image': ['format', () => t('Image')],
  'format.clear': ['format', () => t('Clear formatting')],

  'paragraph.body': ['paragraph', () => t('Paragraph')],
  'paragraph.heading-1': ['paragraph', () => t('Heading {level}', { level: 1 })],
  'paragraph.heading-2': ['paragraph', () => t('Heading {level}', { level: 2 })],
  'paragraph.heading-3': ['paragraph', () => t('Heading {level}', { level: 3 })],
  'paragraph.heading-4': ['paragraph', () => t('Heading {level}', { level: 4 })],
  'paragraph.heading-5': ['paragraph', () => t('Heading {level}', { level: 5 })],
  'paragraph.heading-6': ['paragraph', () => t('Heading {level}', { level: 6 })],
  'paragraph.heading-up': ['paragraph', () => t('One heading level up')],
  'paragraph.heading-down': ['paragraph', () => t('One heading level down')],
  'paragraph.table': ['paragraph', () => t('Table')],
  'paragraph.code-block': ['paragraph', () => t('Code block')],
  'paragraph.math-block': ['paragraph', () => t('Math block')],
  'paragraph.quote': ['paragraph', () => t('Quote')],
  'paragraph.ordered-list': ['paragraph', () => t('Numbered list')],
  'paragraph.bullet-list': ['paragraph', () => t('Bulleted list')],
  'paragraph.rule': ['paragraph', () => t('Horizontal rule')],

  'edit.indent': ['edit', () => t('Indent')],
  'edit.outdent': ['edit', () => t('Outdent')],
  'edit.run-fence': ['edit', () => t('Run this code block')],
  'edit.select-word': ['edit', () => t('Select the word')],
  'edit.select-line': ['edit', () => t('Select the line')],
  'edit.copy-markdown': ['edit', () => t('Copy as markdown')],
  'edit.paste-plain': ['edit', () => t('Paste as plain text')],
  'edit.undo': ['edit', () => t('Undo')],
  'edit.redo': ['edit', () => t('Redo')],
  'edit.redo.alt': ['edit', () => t('Redo')],
  'edit.select-all': ['edit', () => t('Select all')],
  'edit.find': ['edit', () => t('Find')],
  'edit.find-next': ['edit', () => t('Find next')],
  'edit.find-next.alt': ['edit', () => t('Find next')],
  'edit.goto-line': ['edit', () => t('Go to line')],
  'edit.move-line-up': ['edit', () => t('Move the line up')],
  'edit.move-line-down': ['edit', () => t('Move the line down')],
  'edit.copy-line-up': ['edit', () => t('Copy the line up')],
  'edit.copy-line-down': ['edit', () => t('Copy the line down')],

  'table.below': ['table', () => t('Into the table below')],
  'table.above': ['table', () => t('Into the table above')],
  'table.ahead': ['table', () => t('Forward into the table')],
  'table.behind': ['table', () => t('Back into the table')],
  'table.delete': ['table', () => t('Forward into the table instead of deleting')],
  'table.backspace': ['table', () => t('Back into the table instead of deleting')],

  'image.select-behind': ['picture', () => t('Select the picture behind')],
  'image.select-ahead': ['picture', () => t('Select the picture ahead')],
  'image.edit': ['picture', () => t('Edit the picture’s markdown')],
  'image.leave': ['picture', () => t('Leave the selected picture')],
  'image.step-up': ['picture', () => t('Step off the picture upwards')],
  'image.step-down': ['picture', () => t('Step off the picture downwards')],
}

/** The editor's bindings, in the order the editor installs them. */
const EDITOR_SPECS: BindingSpec[] = [...nibBindings, ...standardBindings, ...tableBindings, ...imageBindings]

function fromEditor(spec: BindingSpec): Shortcut {
  const named = EDITOR_ENTRIES[spec.id]

  return {
    id: spec.id,
    label: named ? named[1] : () => spec.id,
    category: named ? named[0] : 'edit',
    scope: 'editor',
    key: spec.key,
    mac: spec.mac,
    win: spec.win,
    linux: spec.linux,
    contextual: spec.contextual,
    alias: spec.alias,
  }
}

/** Runs an app-level command. The two that need the component say so through
 *  the context; everything else reaches the stores directly, the way the
 *  command palette does. */
const APP_ENTRIES: Shortcut[] = [
  {
    id: 'app.save',
    label: () => t('Save'),
    category: 'file',
    scope: 'app',
    key: 'Mod-s',
    run: () => void workspace.save(),
  },
  {
    id: 'app.new',
    label: () => t('New note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-n',
    run: () => workspace.openBlank(),
  },
  {
    id: 'app.new.alt',
    label: () => t('New note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-t',
    alias: true,
    run: () => workspace.openBlank(),
  },
  {
    id: 'app.new-window',
    label: () => t('New window'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-n',
    run: () => void invoke('new_window').catch(() => undefined),
  },
  {
    id: 'app.open',
    label: () => t('Open file'),
    category: 'file',
    scope: 'app',
    key: 'Mod-o',
    run: () => void openFile(),
  },
  {
    id: 'app.close',
    label: () => t('Close note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-w',
    run: () => workspace.activeTabId && workspace.close(workspace.activeTabId),
  },
  {
    id: 'app.settings',
    label: () => t('Settings'),
    category: 'file',
    scope: 'app',
    key: 'Mod-,',
    run: () => settings.show(),
  },
  // Cmd+Tab is the Mac's own application switcher and never reaches a window,
  // so there the note switcher is Ctrl+Tab, which is what a Mac browser uses.
  {
    id: 'app.next-note',
    label: () => t('Next note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Tab',
    mac: 'Ctrl-Tab',
    run: () => cycleTab(1),
  },
  {
    id: 'app.previous-note',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Tab',
    mac: 'Ctrl-Shift-Tab',
    run: () => cycleTab(-1),
  },
  {
    id: 'app.palette',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Mod-p',
    run: (context) => context.palette(),
  },
  {
    id: 'app.sidebar',
    label: () => t('Show sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-l',
    run: () => workspace.toggleSidebar(),
  },
  {
    id: 'app.files',
    label: () => t('Files'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-3',
    run: () => workspace.showPanel('tree'),
  },
  {
    id: 'app.search',
    label: () => t('Search this space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-f',
    run: () => workspace.showPanel('search'),
  },
  {
    id: 'app.source',
    label: () => t('Source mode'),
    category: 'view',
    scope: 'app',
    key: 'Mod-/',
    run: (context) => modes.toggleSource(context.view),
  },
  {
    id: 'app.focus',
    label: () => t('Focus mode'),
    category: 'view',
    scope: 'app',
    key: 'F8',
    run: (context) => modes.toggleFocus(context.view),
  },
  {
    id: 'app.typewriter',
    label: () => t('Typewriter mode'),
    category: 'view',
    scope: 'app',
    key: 'F9',
    run: (context) => modes.toggleTypewriter(context.view),
  },
  {
    id: 'app.reading',
    label: () => t('Reading mode'),
    category: 'view',
    scope: 'app',
    key: 'F10',
    run: (context) => modes.toggleReading(context.view),
  },
  {
    id: 'app.fullscreen',
    label: () => t('Fullscreen'),
    category: 'view',
    scope: 'app',
    key: 'F11',
    run: (context) => context.fullscreen(),
  },
  {
    id: 'app.zoom-in',
    label: () => t('Zoom in'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-=',
    run: () => modes.stepZoom(1),
  },
  {
    id: 'app.zoom-out',
    label: () => t('Zoom out'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift--',
    run: () => modes.stepZoom(-1),
  },
  {
    id: 'app.zoom-reset',
    label: () => t('Actual size'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-0',
    run: () => modes.resetZoom(),
  },
]

function cycleTab(direction: number) {
  const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeTabId)
  if (index < 0) return

  const next = (index + direction + workspace.tabs.length) % workspace.tabs.length
  workspace.activate(workspace.tabs[next].id)
}

/** Keys that are spoken for and cannot be handed to something else.
 *
 *  They are in the list rather than left out of it, because a shortcut that
 *  is missing from a list of every shortcut reads as an oversight. Each says
 *  why: the clipboard belongs to the system, and the keys that move the caret
 *  and delete characters are how a text editor works rather than choices
 *  anybody made. */
const FIXED_ENTRIES: Shortcut[] = [
  {
    id: 'fixed.cut',
    label: () => t('Cut'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-x',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.copy',
    label: () => t('Copy'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-c',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.paste',
    label: () => t('Paste'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-v',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.caret',
    label: () => t('Moving the caret'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('The arrow keys, Home, End, Page up and Page down belong to the text.'),
  },
  {
    id: 'fixed.delete',
    label: () => t('Deleting a character'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('Backspace and Delete belong to the text.'),
  },
  {
    id: 'fixed.newline',
    label: () => t('New line'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Enter',
    why: () => t('Enter closes a code block and carries a list on.'),
  },
  {
    id: 'fixed.tab',
    label: () => t('Indent with Tab'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Tab',
    why: () => t('Tab moves on through the app as well as indenting.'),
  },
  {
    id: 'fixed.escape',
    label: () => t('Escape'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Escape',
    why: () => t('Escape closes whatever is open.'),
  },
  {
    id: 'fixed.quit',
    label: () => t('Quit'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Alt-F4',
    mac: 'Mod-q',
    why: () => t('Your system takes this key before the app sees it.'),
  },
]

/** Every shortcut there is, in the order the settings list shows them. */
export const SHORTCUTS: Shortcut[] = [
  ...APP_ENTRIES,
  ...EDITOR_SPECS.map(fromEditor),
  ...FIXED_ENTRIES,
]

const BY_ID = new Map(SHORTCUTS.map((one) => [one.id, one]))

/** Combinations the machine underneath usually swallows. Not a refusal - the
 *  app cannot know what a given system does with a given key - but a warning
 *  beside the binding, so nobody sets a key and wonders why nothing happens. */
const SYSTEM_KEYS: Record<Platform, string[]> = {
  mac: ['Mod-q', 'Mod-h', 'Mod-m', 'Mod-Tab', 'Mod-Space', 'Mod-Shift-3', 'Mod-Shift-4', 'Mod-Shift-5'],
  win: ['Alt-F4', 'Alt-Tab', 'Meta-l', 'Ctrl-Shift-Escape'],
  linux: ['Alt-F4', 'Alt-Tab'],
}

/** And the ones a browser keeps for itself. Only a worry in the browser: the
 *  packaged app has no tabs to close and no developer tools to open. */
const BROWSER_KEYS = [
  'F12',
  'F5',
  'F11',
  'Mod-Shift-i',
  'Mod-Shift-j',
  'Mod-Shift-c',
  'Mod-r',
  'Mod-Shift-r',
  'Mod-w',
  'Mod-t',
  'Mod-n',
  'Mod-Shift-n',
]

class Shortcuts {
  /** Only what differs from the defaults, by id. A key, or null where the
   *  reader took the key away.
   *
   *  Ids this version knows nothing about are kept exactly as they came in.
   *  A newer version of the app may have bound something this one has never
   *  heard of, and dropping it here would be this machine quietly undoing
   *  that machine's choice the next time anything else changed. */
  overrides = $state<KeyOverrides>({})

  readonly platform = currentPlatform()

  restore() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      this.overrides = usable(saved)
    }
    catch {
      // A corrupt entry just means the defaults.
    }
  }

  /** The key an entry answers to, resolved for this platform: what the reader
   *  chose, or the default. Null where it is unbound. */
  keyFor(id: string): string | null {
    if (id in this.overrides) return this.overrides[id]

    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  /** What it started as, for the button that puts it back. */
  defaultFor(id: string): string | null {
    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  changed(id: string): boolean {
    return id in this.overrides && this.overrides[id] !== this.defaultFor(id)
  }

  /** The key as a reader reads it, for a menu row or the palette. Undefined
   *  when there is none, so a caller can leave the hint off entirely. */
  hint(id: string): string | undefined {
    const key = this.keyFor(id)
    return key ? showCombination(key, this.platform) : undefined
  }

  /** The entries a combination would collide with.
   *
   *  Contextual bindings are left out on both sides: they look for a table or
   *  a picture where the caret is and give way when it is not there, which is
   *  how six of them already share the arrow keys with the editor's own
   *  motion. Everything else that would answer to the same keystroke is a
   *  real collision, app and editor alike - an app binding is read off the
   *  window and never reaches the editor, so the two cannot share a key. */
  conflicts(id: string, key: string): Shortcut[] {
    const entry = BY_ID.get(id)
    if (!key || entry?.contextual) return []

    return SHORTCUTS.filter((one) => {
      if (one.id === id || one.contextual || one.scope === 'fixed') return false

      const held = this.keyFor(one.id)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  /** A fixed key the combination would land on. Not resolvable - it says what
   *  will happen, and the reader decides. */
  fixedHolder(key: string): Shortcut | undefined {
    if (!key) return undefined

    return FIXED_ENTRIES.find((one) => {
      const held = defaultKeyFor(one, this.platform)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  /** Why a combination may never arrive. Null when nothing is known against
   *  it, which is not a promise that it works - only that nothing here says
   *  otherwise. */
  warning(key: string | null): string | null {
    if (!key) return null

    const taken = (list: string[]) => list.some((one) => sameCombination(one, key, this.platform))
    if (taken(SYSTEM_KEYS[this.platform])) return t('Your system takes this key before the app sees it.')
    if (!isDesktop && taken(BROWSER_KEYS)) return t('Your browser takes this key before the app sees it.')

    return null
  }

  /** Whether a combination is one the app will accept at all. A bare letter
   *  or digit would fire on every keystroke that types it, so it is refused
   *  with the reason rather than saved and wondered about later. */
  refuse(key: string): string | null {
    const combination = parseCombination(key, this.platform)
    if (!combination) return t('That is not a key combination.')

    const bare = !combination.ctrl && !combination.meta && !combination.alt
    if (bare && combination.key.length === 1) return t('Hold Ctrl, Alt or Cmd as well.')

    return null
  }

  set(id: string, key: string | null) {
    if (Object.keys(this.overrides).length >= MOST_OVERRIDES && !(id in this.overrides)) return

    this.overrides = { ...this.overrides, [id]: key }
    this.settle()
  }

  reset(id: string) {
    const rest = { ...this.overrides }
    delete rest[id]
    this.overrides = rest
    this.settle()
  }

  resetAll() {
    this.overrides = {}
    this.settle()
  }

  /** Writes the choice down, tells the editor on screen, and tells the
   *  account. Everything that shows a key reads it from here, so the menus
   *  and the palette follow on their own. */
  private settle() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides))
    if (this.view) setShortcutKeys(this.view, this.overrides)
    this.share()
  }

  private view: EditorView | undefined

  /** A view is built fresh for every note, and starts at the defaults. */
  apply(view: EditorView) {
    this.view = view
    setShortcutKeys(view, this.overrides)
  }

  /** What the app hands the editor when it builds one, so the first keystroke
   *  after a note opens is already the reader's own. */
  get forEditor(): KeyOverrides {
    return this.overrides
  }

  /** Takes over the account's keys. Same rule as every other account setting:
   *  the last machine to change something wins, and this is a machine finding
   *  out what that was. Nothing is merged key by key - two machines editing
   *  the same account's shortcuts at once would otherwise end up with a set
   *  neither of them chose. */
  receive(remote: AccountSettings) {
    const theirs = remote.shortcuts
    // An account that has never been told anything about keys takes this
    // machine's, which is how a choice made before signing in follows the
    // account afterwards rather than being lost at the door.
    if (!theirs || typeof theirs !== 'object') {
      if (Object.keys(this.overrides).length) this.share()
      return
    }

    const usableOnes = usable(theirs)
    if (JSON.stringify(usableOnes) === JSON.stringify(this.overrides)) return

    this.overrides = usableOnes
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides))
    if (this.view) setShortcutKeys(this.view, this.overrides)
  }

  /** Tells the account, when there is one. Signed out, the choice is this
   *  machine's alone and is carried up whenever an account is signed into. */
  private share() {
    const token = account.token
    if (!token) return

    void api.saveSettings(token, { shortcuts: this.overrides }).catch(() => undefined)
  }

  /** Runs whatever the keystroke is bound to at app level. True when it did,
   *  which is the caller's signal that the key is spent. */
  handle(event: KeyboardEvent, context: AppContext): boolean {
    for (const entry of SHORTCUTS) {
      if (entry.scope !== 'app' || !entry.run) continue

      const key = this.keyFor(entry.id)
      if (!key || !matchesCombination(key, event, this.platform)) continue

      event.preventDefault()
      entry.run(context)
      return true
    }

    return false
  }
}

/** A stored map, cleaned of anything that is not a key or a taking-away. The
 *  server checks the same things, but a file on this machine never went
 *  through the server. */
function usable(value: unknown): KeyOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const kept: KeyOverrides = {}
  for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
    if (key === null) kept[id] = null
    else if (typeof key === 'string' && key.length <= 40 && key.length > 0) kept[id] = key

    if (Object.keys(kept).length >= MOST_OVERRIDES) break
  }

  return kept
}

export const shortcuts = new Shortcuts()
