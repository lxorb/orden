import { registerPaletteKind, registerSettingFields, registerSettingsPart } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { isDesktop } from '../../platform/src/api'
import { partView } from '../../ui-kit/src/api'

if (!__EVEN_PLUGIN__) {
  registerPaletteKind('hosts', () => import('./palette-hosts').then((one) => one.hosts))
  registerSettingFields({
    section: 'general',
    group: 'Terminal',
    load: () => import('./setting-fields').then((one) => one.terminalFields),
  })
  registerSettingsPart({
    section: 'remote',
    card: false,
    shown: () => true,
    places: () =>
      isDesktop
        ? [{ label: 'Add host', text: ['SSH', 'ssh config', 'Remote', 'Open config'] }]
        : [],
    load: async () => partView((await import('./remote/RemotePane.svelte')).default, () => ({})),
  })
  registerSettingsPart({
    section: 'online',
    card: false,
    shown: () => true,
    places: () =>
      account.user
        ? [{ label: 'Online terminal', text: ['Machine', 'Start', 'Stop', 'Hours', 'CPU'] }]
        : [],
    load: async () => partView((await import('./online/OnlinePane.svelte')).default, () => ({})),
  })
}
