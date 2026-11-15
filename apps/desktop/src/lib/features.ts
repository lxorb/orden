import {
  registerAgentTabKind,
  registerAgentVerbs,
  registerCommand,
  registerHearing,
  registerCommandRows,
  registerCommands,
  providePort,
  registerFeature,
  registerSettingsPart,
  registerSidebarPart,
  registerTabKind,
  runCommand,
  whenPortProvided,
} from '@orden/contracts'
import { askPart } from './ai-chat/src/api'
import { outlinePart } from './pages/src/api'
import { scratchpadPart } from './scratchpad/src/api'
import { serveLinks } from './link-index/src/api'
import { searchSpace } from './search/src/api'
import { partView } from './ui-kit/src/api'
import { samePath } from './platform/src/api'
import { hiddenKinds } from './settings.svelte'

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
registerCommandRows('ai-accounts', async () => (await import('./ai-providers/src/api')).accountRows)
registerCommandRows('record', async () => (await import('./dictation/src/api')).recordRows)

if (!__EVEN_PLUGIN__) {
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
  providePort('explorer.show', {
    offered: () => hiddenKinds.offers('explorer'),
    show: async (path) => (await import('./explorer/src/api')).showInExplorer(path),
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
