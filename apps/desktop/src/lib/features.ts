import {
  registerCommand,
  registerHearing,
  registerCommandRows,
  registerCommands,
  registerFeature,
  registerSettingsPart,
  registerTabKind,
} from '@orden/contracts'
import { partView } from './ui-kit/src/api'

registerFeature(() => import('./quick-add/src/api'))
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
