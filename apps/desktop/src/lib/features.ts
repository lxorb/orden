import {
  registerAgentTabKind,
  registerAgentVerbs,
  registerCommand,
  registerHearing,
  registerCommandRows,
  commandRowsLoaded,
  registered,
  registerCommands,
  providePort,
  registerFeature,
  registerSettingsPart,
  registerSidebarPart,
  registerSurfaces,
  registerTabKind,
  runCommand,
  whenPortProvided,
} from '@orden/contracts'
import { loadFind, loadLineCommands, setBlocks } from '@orden/editor'
import { askPart, loadRewriteSheet, rewritingStore } from './ai-chat/src/api'
import { outlinePart } from './pages/src/api'
import { scratchpadPart } from './scratchpad/src/api'
import { serveLinks } from './link-index/src/api'
import { loadSearchPanel, search, searchFrom, searchSpace, showSearch } from './search/src/api'
import { partView, reloadWhen } from './ui-kit/src/api'
import { samePath, breathe } from './platform/src/api'
import { hiddenKinds } from './gates/src/api'
import { loadSettingsPanel, settings } from './settings/src/api'
import { paletteDoor } from './palette/src/api'
import { loadGraph } from './graph-view/src/api'
import { archive, loadArchive, loadArchivedStrip, showArchive, unarchive } from './archive/src/api'
import { loadPrivateMark, loadWebTab, siteDropping, webDataSheet } from './web-tab/src/api'
import { warmCalls } from './accounts/src/api'
import { focusEditor, noteCovers, paneMoves } from './workspace/src/api'
import { previewCards } from './pane-tree/src/api'
import { startup } from './launch/src/api'
import {
  contextMenu,
  fillBar,
  findBar,
  formatBar,
  joinSheet,
  linksPanel,
  promptSheet,
  quickAddSheet,
  readingSurface,
  searchPanel,
  sheets,
  signInSheet,
  spacePickerDialog,
  spacesMenu,
  undoToastNotice,
} from './surfaces/src/api'

serveLinks({
  html: async (text, path) => {
    const [{ readingHtml }, { theme }, { trustsHtmlAt }] = await Promise.all([
      import('./reading/src/api'),
      import('./theme/src/api'),
      import('./sharing/src/api'),
    ])
    return readingHtml({ text, path }, theme.current, trustsHtmlAt(path))
  },
  files: async () => (await import('./reading/src/api')).drawFile,
  bases: async () => (await (await import('./views/src/api')).baseMounting()).mountBase,
  plane: async (note) => {
    if (__EVEN_PLUGIN__) return null
    const [{ CanvasStore }, { workspace }] = await Promise.all([
      import('./canvas/src/api'),
      import('./workspace/src/api'),
    ])
    const doc = workspace.documents.find((one) => one === note)
    return doc ? CanvasStore.drawing(doc, workspace.tabs) : null
  },
  search: searchSpace,
})
providePort('search', { panel: search, show: showSearch, fromView: searchFrom })
providePort('settings.window', settings)
providePort('shell.sheets', sheets)
providePort('shell.focus', { editor: focusEditor })
providePort('quick-add.show', {
  show: (prefill = {}) => {
    if (__EVEN_PLUGIN__) return
    void quickAddSheet.ask()
    void import('./quick-add/src/api').then(({ quickAdd }) => quickAdd.show(prefill))
  },
})
registerSurfaces({
  graph: loadGraph,
  settings: () => Promise.all([loadSettingsPanel(), registered()]).then(([one]) => one),
  view: () => import('./views/src/api').then((one) => one.loadViewTab()),
  terminal: () => import('./terminal/src/api').then((one) => one.loadTerminalTab()),
  reading: () => import('./reading/src/api').then((one) => one.loadReading()),
  'find-bar': () => import('./reading/src/api').then((one) => ({ default: one.FindBar })),
  publish: () => import('./publishing/src/api').then((one) => one.loadPublishSheet()),
  import: () => import('./import/src/api').then((one) => one.loadImportSheet()),
  rewrite: loadRewriteSheet,
  'recording-pill': () => import('./dictation/src/api').then((one) => one.loadRecordingPill()),
  overview: () => import('./overview/src/api').then((one) => one.loadOverview()),
  'host-picker': () => import('./terminal/src/api').then((one) => one.loadHostPicker()),
  'terminal-mark': () => import('./terminal/src/api').then((one) => one.loadTerminalMark()),
  'quick-add': () => import('./quick-add/src/api').then((one) => one.loadQuickAddSheet()),
  'private-mark': loadPrivateMark,
  'search-panel': loadSearchPanel,
  links: () => import('./links-panel/src/api').then((one) => one.loadLinksPanel()),
})
registerSidebarPart(askPart)
registerSidebarPart(outlinePart)
registerSidebarPart(scratchpadPart)
registerSidebarPart({ id: 'tasks', toTab: () => runCommand('views.todos').then(() => undefined) })
registerFeature(() => import('./quick-add/src/api'))
registerTabKind('view', async () => (await import('./views/src/api')).viewTabKind)
whenPortProvided('workspace.view', (view) =>
  view.follow((op) => {
    const tree = view.tree
    if (op.op !== 'moved' || op.kind === 'space' || !op.root || !tree || op.heard) return
    const root = op.root
    if (!samePath(root, view.activeRoot ?? '')) return
    return (async () => {
      const { orderMoved } = await import('./views/src/api')
      await orderMoved(tree, root, op.from, op.to)
    })().catch(() => undefined)
  }),
)
registerCommand('app.quick-question', async () => (await import('./ai-chat/src/api')).askQuickly)
registerCommand(
  'app.scratchpad',
  async () => (await import('./scratchpad/src/api')).toggleScratchpad,
)
for (const row of ['random-note', 'print']) {
  registerCommand(`app.${row}`, async () => {
    const { runRow } = await import('./commands/src/api')
    return () => void runRow(row)
  })
}
registerSettingsPart({
  section: 'ai',
  card: false,
  shown: () => true,
  load: async () => (await import('./ai-sidebar/src/api')).aiPane(),
})
registerCommands('import.', async () => (await import('./import/src/api')).importCommands)
registerCommands('views.', async () => (await import('./views/src/api')).viewCommands)
registerCommands('export.', async () => (await import('./export/src/api')).exportRuns)
providePort('commands.app', {
  rows: async (view) => {
    const { appCommands } = await import('./commands/src/api')
    return appCommands(view as Parameters<typeof appCommands>[0])
  },
})
registerCommandRows('ai-accounts', async () => (await import('./ai-providers/src/api')).accountRows)
registerCommandRows('record', async () => (await import('./dictation/src/api')).recordRows)
registerCommandRows('transcribe', async () => (await import('./dictation/src/api')).transcribeRows)
registerCommandRows('rewrite', async () => (await rewritingStore()).rewriteRows)

if (__EVEN_PLUGIN__) {
  const waits = () => new Promise<never>(() => undefined)
  registerSurfaces({
    tasks: waits,
    todos: waits,
    channel: waits,
    'chat-links': waits,
    chats: waits,
    'time-panel': waits,
    'pass-fill': waits,
    'takeover-bar': waits,
    'agent-rows': waits,
    'agent-session': waits,
    spark: waits,
    'phone-tabs': waits,
    'phone-you': waits,
  })
}

if (!__EVEN_PLUGIN__) {
  registerSurfaces({
    canvas: () => import('./canvas/src/api').then((one) => one.loadCanvas()),
    tasks: () => import('./tasks-views/src/api').then((api) => ({ default: api.TodosPanel })),
    todos: () => import('./tasks-views/src/api').then((api) => ({ default: api.TodosBoard })),
    channel: () => import('./chats-client/src/api').then((one) => one.loadChatTab()),
    'chat-links': () => import('./chats-client/src/api').then((one) => one.loadChatLinks()),
    chats: () => import('./chats-client/src/api').then((one) => one.loadChatsPanel()),
    'time-panel': () => import('./time/src/api').then((one) => one.loadTimePanel()),
    time: () => import('./time/src/api').then((one) => one.loadTimeTab()),
    pages: () => import('./pages/src/api').then((one) => one.loadPages()),
    'pages-navigator': () => import('./pages/src/api').then((one) => one.loadNavigator()),
    web: loadWebTab,
    application: () => import('./apps/src/api').then((one) => one.loadApplicationTab()),
    explorer: () => import('./explorer/src/api').then((one) => one.loadExplorerTab()),
    pass: () => import('./pass-ui/src/api').then((one) => one.loadPassTab()),
    'pass-fill': () => import('./pass-ui/src/api').then((one) => one.loadPassFill()),
    'takeover-bar': () => import('./agents/src/api').then((one) => one.loadTakeoverBar()),
    'agent-rows': () => import('./agents/src/api').then((one) => one.loadAgentRows()),
    'agent-session': () => import('./agents/src/api').then((one) => one.loadAgentSession()),
    spark: () => import('./agents/src/api').then((one) => ({ default: one.Spark })),
    'phone-tabs': () => import('./phone/src/api').then((one) => one.loadPhoneTabs()),
    'phone-you': () => import('./phone/src/api').then((one) => one.loadPhoneYou()),
    ask: () => import('./ai-sidebar/src/api').then((one) => one.loadChatPanel()),
    archive: loadArchive,
    'archived-strip': loadArchivedStrip,
    export: () => import('./export/src/api').then((one) => one.loadExportSheet()),
    'quick-question': () => import('./ai-sidebar/src/api').then((one) => one.loadQuickQuestion()),
    'scratchpad-card': () => import('./scratchpad/src/api').then((one) => one.loadScratchpadCard()),
    'keys-moved': () => import('./ai-providers/src/api').then((one) => one.loadKeysMoved()),
    'crash-ask': () => import('./crash-reports/src/api').then((one) => one.loadCrashAsk()),
    'undo-toast': () => import('./workspace/src/api').then((one) => one.loadUndoToast()),
  })
  registerSidebarPart({
    id: 'time',
    menu: async () => (await import('./time/src/api')).trackingMenu(),
    toTab: async () => void (await import('./time/src/api')).openTime(),
  })
  registerFeature(() => import('./agents/src/api'))
  registerFeature(() => import('./chats-client/src/api'))
  registerFeature(() => import('./crash-reports/src/api'))
  registerFeature(() => import('./terminal/src/api'))
  registerTabKind('terminal', async () => (await import('./terminal/src/api')).terminalTabKind())
  registerCommand(
    'app.new-private',
    async () => (await (await import('./web-tab/src/api')).privateWindows()).openPrivate,
  )
  registerCommand(
    'app.ask-selection',
    async () => (await (await import('./ai-chat/src/api')).chatQuoting()).quoteSelection,
  )
  registerCommand(
    'agents.stop',
    async () => (await (await import('./agents/src/api')).agentsUi()).stopAgents,
  )
  registerCommand('app.explorer', async () => (await import('./explorer/src/api')).openExplorer)
  registerCommand('app.handwriting', async () => {
    const { handwrite } = await (await import('./canvas/src/api')).handwriting()
    return () => void handwrite()
  })
  providePort('explorer.show', {
    offered: () => hiddenKinds.offers('explorer'),
    show: async (path) => (await import('./explorer/src/api')).showInExplorer(path),
  })
  providePort('explorer.carry', {
    carry: async (paths, into, how) =>
      (await import('./explorer/src/api')).carry(null, paths, into, how),
  })
  providePort('web.sites', {
    dropped: async (folder, list, html) => {
      const [{ siteDropped }, { workspace }] = await Promise.all([
        siteDropping(),
        import('./workspace/src/api'),
      ])
      return siteDropped(workspace, folder, list, html)
    },
    showData: async (path) => (await webDataSheet()).showWebData(path),
  })
  providePort('archive', { archive, unarchive, show: showArchive })
  providePort('publishing', {
    show: async (space) => (await import('./publishing/src/api')).publish.show(space),
  })
  providePort('web.siteIcons', {
    held: async () => (await (await import('./web-tab/src/api')).siteIconSet()).siteIcons,
  })
  registerCommands('pass.', async () => (await import('./pass-sync/src/api')).passCommands)
  registerCommands('terminal.', async () => (await import('./terminal/src/api')).terminalCommands)
  registerCommand('ai.threads', async () => {
    const { chat } = await (await import('./ai-chat/src/api')).chatStore()
    return () => chat.showThreads()
  })
  registerCommandRows('export', async () => (await import('./export/src/api')).exportCommands)
  registerCommandRows('export-picker', async () => (await import('./export/src/api')).exportPicker)
  registerCommandRows('agent-undo', async () => (await import('./agent-docs/src/api')).undoRows)
  registerCommandRows('send', async () => (await import('./chats-client/src/api')).sendRows)
  registerCommands('time.', async () => (await import('./time/src/api')).timeCommands)
  registerHearing(async () => (await (await import('./web-tab/src/api')).pagesHanded()).hearPages)
  registerHearing(async () => (await (await import('./pdf/src/api')).handed()).hearPdfs)
  registerTabKind('application', async () => (await import('./apps/src/api')).applicationTabKind)
  registerTabKind('chat', async () => (await import('./chats-client/src/api')).chatTabKind)
  registerAgentVerbs(async () => (await import('./agent-host/src/api')).hostVerbs)
  registerAgentVerbs(async () => (await import('./explorer/src/api')).explorerVerbs())
  registerAgentVerbs(async () => (await import('./apps/src/api')).applicationVerbs())
  registerAgentVerbs(async () => (await import('./chats-client/src/api')).chatVerbs())
  registerAgentVerbs(
    async () => (await (await import('./terminal/src/api')).terminalAgent()).terminalVerbs,
  )
  registerAgentTabKind(
    'terminal',
    async () => (await (await import('./terminal/src/api')).terminalAgent()).terminalTabs,
  )
  registerAgentTabKind(
    'online',
    async () => (await (await import('./terminal/src/api')).terminalAgent()).onlineTabs,
  )
  registerSettingsPart({
    section: 'import',
    card: true,
    shown: () => true,
    load: async () => {
      const { loadMigrateRows } = await import('./import/src/api')
      return partView((await loadMigrateRows()).default, () => ({}))
    },
  })
}

export async function warmDoors(): Promise<void> {
  await startup.turn('doors')
  await knock([
    () => findBar(),
    () => searchPanel(),
    () => linksPanel(),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./native-menu/src/api').then((one) => one.appMenuRows()),
    () => readingSurface(),
    () => loadFind(),
    () => loadLineCommands(),
    () =>
      Promise.all([import('./commands/src/api'), commandRowsLoaded()]).then(([{ blockRows }]) =>
        setBlocks(blockRows),
      ),
    () => spacePickerDialog.ask(),
    () => spacesMenu(),
    () => paletteDoor.ask(),
    () => promptSheet.ask(),
    () => contextMenu.ask(),
    () => formatBar.ask(),
    () => signInSheet.ask(),
    () => joinSheet.ask(),
    __EVEN_PLUGIN__ ? undefined : () => undoToastNotice.ask(),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./context-menu/src/api').then((one) => one.loadFieldMenu()),
    () => import('./ai-providers/src/api'),
    () => import('./tab-strip/src/api').then((one) => one.tabMenus()),
    () => import('./tab-strip/src/api').then((one) => one.stripMenus()),
    () => import('./row-menu/src/api').then((one) => one.rowMenus()),
    () => import('./editor-menu/src/api'),
    () => import('./tab-cycle/src/api'),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./tab-strip/src/api').then((one) => one.tabNumbers()),
    __EVEN_PLUGIN__ ? undefined : () => paneMoves().then((one) => one.followPointer()),
    __EVEN_PLUGIN__ ? undefined : () => fillBar(),
    previewCards,
    noteCovers,
    () => warmCalls(),
    __EVEN_PLUGIN__
      ? undefined
      : () =>
          Promise.all([import('./first-screen/src/api'), import('./workspace/src/api')]).then(
            ([one, { workspace }]) => one.keepFirstScreens(workspace),
          ),
    () => reloadWhen(),
    () => import('./ui-controls/src/api').then((one) => one.watchKeyboard()),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./back-swipe/src/api').then((one) => one.listenSwipes()),
  ])
}

async function knock(doors: readonly ((() => unknown) | undefined)[]): Promise<void> {
  const asked: Promise<unknown>[] = []
  for (const open of doors) {
    if (!open) continue
    const one = Promise.resolve().then(open)
    one.catch(() => undefined)
    asked.push(one)
    await breathe()
  }
  await Promise.all(asked)
}
