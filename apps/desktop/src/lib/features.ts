import {
  registerCommand,
  registerHearing,
  registerCommandRows,
  registerCommands,
  registerFeature,
  registerSettingsPart,
  registerTabKind,
  whenPortProvided,
} from '@orden/contracts'
import { serveLinks } from './link-index/src/api'
import { searchSpace } from './search/src/api'
import { partView } from './ui-kit/src/api'
import { samePath } from './platform/src/api'

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
      import('./workspace.svelte'),
    ])
    const doc = workspace.documents.find((one) => one === note)
    return doc ? CanvasStore.drawing(doc, workspace.tabs) : null
  },
  search: searchSpace,
})
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
registerCommand('app.print', async () => {
  const { runRow } = await import('./commands/src/api')
  return () => void runRow('print')
})
registerCommands('views.', async () => (await import('./views/src/api')).viewCommands)
registerCommandRows('ai-accounts', async () => (await import('./ai-providers/src/api')).accountRows)
registerCommandRows('record', async () => (await import('./dictation/src/api')).recordRows)

if (!__EVEN_PLUGIN__) {
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
  registerCommands('pass.', async () => (await import('./pass-sync/src/api')).passCommands)
  registerCommands('terminal.', async () => (await import('./terminal/src/api')).terminalCommands)
  registerCommands('import.', async () => (await import('./import/src/api')).importCommands)
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
