import {
  registerCommand,
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
  registerCommand('app.pass', async () => (await import('./pass-sync/src/api')).openPass)
  registerCommand('time.tab', async () => {
    const { openTime } = await import('./time/src/api')
    return () => void openTime()
  })
  registerCommand('time.start', async () => (await import('./time/src/api')).startTimer)
  registerCommand('time.stop', async () => (await import('./time/src/api')).stopTimer)
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
