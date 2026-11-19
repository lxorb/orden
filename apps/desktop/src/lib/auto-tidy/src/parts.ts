import { registerSettingFields } from '@orden/contracts'

registerSettingFields({
  section: 'general',
  group: 'Tabs',
  load: () => import('./fields').then((one) => one.tidyFields),
})
