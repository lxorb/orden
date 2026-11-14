import { registerPaletteKind, registerSettingFields, registerSettingsPart } from '@orden/contracts'
import { isDesktop, platform } from '../../platform/src/api'

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
    shown: () => runsExtensions,
    load: () => import('./extension-rows').then((one) => one.extensionRows),
  })
}
