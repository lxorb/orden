import { registerSettingsPart, settingsWindow, syncStore, workspaceView } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { partView } from '../../ui-kit/src/api'

export const membersRoot = (): string | null => settingsWindow().space ?? workspaceView().activeRoot
registerSettingsPart({
  section: 'space',
  title: 'Members',
  card: true,
  order: 1,
  shown: () => {
    const root = membersRoot()
    return account.signedIn && root !== null && !!syncStore()?.remoteIdFor(root)
  },
  places: () => [{ label: 'Members', text: ['People', 'Role', 'Admin', 'Remove'] }],
  load: async () => partView((await import('./MembersPart.svelte')).default, () => ({})),
})
