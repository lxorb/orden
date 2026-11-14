import { registerPaletteKind, registerSettingFields, registerSettingsPart } from '@orden/contracts'
import { isDesktop, platform } from '../../platform/src/api'
import { partView } from '../../ui-kit/src/api'

export const runsExtensions = isDesktop && (platform() === 'windows' || platform() === 'linux')

if (!__EVEN_PLUGIN__) {
  registerPaletteKind('visits', () => import('./palette-visits').then((one) => one.visits))
  registerSettingFields({
    section: 'general',
    group: 'Browser',
    load: () => import('./setting-fields.svelte').then((one) => one.browserFields),
  })
  registerSettingFields({
    section: 'general',
    group: 'Tabs',
    load: () => import('./setting-fields.svelte').then((one) => one.tabFields),
  })
  registerSettingsPart({
    section: 'general',
    title: 'Extensions',
    card: true,
    shown: () => runsExtensions,
    load: async () => partView((await import('./ExtensionRows.svelte')).default, () => ({})),
  })
}
