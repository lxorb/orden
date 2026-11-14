import { registerFeature, registerSettingsPart } from '@orden/contracts'
import { partView } from './ui-kit/src/api'

registerFeature(() => import('./quick-add/src/api'))

if (!__EVEN_PLUGIN__) {
  registerFeature(() => import('./agents/src/api'))
  registerFeature(() => import('./chats-client/src/api'))
  registerFeature(() => import('./crash-reports/src/api'))
  registerFeature(() => import('./terminal/src/api'))
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
