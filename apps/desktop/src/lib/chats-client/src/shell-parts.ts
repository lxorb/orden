import { registerSettingFields } from '@orden/contracts'

registerSettingFields({
  section: 'experimental',
  group: 'Chats',
  load: () => import('./setting-fields').then((one) => one.chatsFields),
})
