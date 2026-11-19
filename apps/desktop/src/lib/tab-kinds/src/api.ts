import { isTabKind, type TabKind, type TabKindTraits, type TabPanel } from '@orden/contracts'

export { isTabKind, type TabKind, type TabKindTraits, type TabPanel }
const PLAIN = {
  words: false,
  extension: null,
  statusBar: true,
  mark: null,
  glyph: null,
  liveMark: false,
  editor: false,
  takesDrops: false,
  ownBar: false,
  fileDocument: true,
  plane: false,
  exports: 'none',
  selection: null,
  outsideTitle: false,
  preview: 'drawn',
  panels: [],
  asksToMove: false,
  single: false,
} as const
const PAGED = ['outline', 'links'] as const
const APART = { statusBar: false, fileDocument: false } as const
export const TAB_KINDS = {
  note: {
    ...PLAIN,
    words: true,
    extension: '.md',
    mark: 'note',
    editor: true,
    exports: 'note',
    selection: 'words',
    preview: 'reading',
    panels: PAGED,
    asksToMove: true,
  },
  graph: { ...PLAIN, statusBar: false, glyph: 'graph' },
  pdf: { ...PLAIN, mark: 'pdf', exports: 'file', selection: 'page', panels: PAGED },
  canvas: {
    ...PLAIN,
    words: true,
    extension: '.canvas',
    statusBar: false,
    mark: 'canvas',
    takesDrops: true,
    ownBar: true,
    plane: true,
    exports: 'canvas',
    selection: 'drawing',
    panels: ['links'],
    asksToMove: true,
  },
  pages: {
    ...PLAIN,
    words: true,
    extension: '.pages',
    mark: 'pages',
    ownBar: true,
    plane: true,
    exports: 'pages',
    selection: 'drawing',
    panels: PAGED,
    asksToMove: true,
  },
  web: { ...PLAIN, extension: '.url', mark: 'web', outsideTitle: true, preview: 'photograph' },
  terminal: {
    ...PLAIN,
    mark: 'terminal',
    liveMark: true,
    takesDrops: true,
    selection: 'terminal',
    outsideTitle: true,
    preview: 'scrollback',
  },
  view: { ...PLAIN, mark: 'base', fileDocument: false },
  chat: { ...PLAIN, glyph: 'ask', takesDrops: true, asksToMove: true },
  channel: { ...PLAIN, mark: 'chat', takesDrops: true, fileDocument: false },
  application: { ...PLAIN, mark: 'application', preview: 'picture' },
  explorer: { ...PLAIN, ...APART, mark: 'folder' },
  pass: { ...PLAIN, ...APART, mark: 'key', preview: 'mark', single: true },
  time: { ...PLAIN, ...APART, mark: 'time', single: true },
  settings: { ...PLAIN, ...APART, mark: 'settings', preview: 'mark', single: true },
} as const satisfies Record<TabKind, TabKindTraits>
const KINDS = Object.keys(TAB_KINDS) as readonly TabKind[]
export function kindsWhere(trait: (traits: TabKindTraits) => boolean): TabKind[] {
  return KINDS.filter((kind) => trait(TAB_KINDS[kind]))
}
export { builtinName, readViewSpec, sameView, type ViewSpec, writeViewSpec } from './view-spec'
