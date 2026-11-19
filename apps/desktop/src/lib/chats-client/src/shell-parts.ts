import { registerSettingFields } from '@orden/contracts'

if (!__EVEN_PLUGIN__) {
  registerSettingFields({
    section: 'experimental',
    group: 'Chats',
    load: () => import('./setting-fields').then((one) => one.chatsFields),
  })
}
