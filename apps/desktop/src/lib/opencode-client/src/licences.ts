import { registerSettingFields, type SettingField } from '@orden/contracts'
import { isDesktop } from '../../platform/src/api'

const NAME = 'Open source licences'
async function openLicences(): Promise<void> {
  const [{ default: text }, { workspace }] = await Promise.all([
    import('./licences.txt?raw'),
    import('../../workspace/src/api'),
  ])
  workspace.openReadOnly(NAME, text)
}
const fields: SettingField[] = [
  {
    kind: 'value',
    label: NAME,
    hint: 'The licences of the software Orden uses for its AI: OpenCode and the Bun runtime it runs on.',
    words: ['licence', 'license', 'open source', 'opencode', 'bun', 'credits', 'about', 'legal'],
    get: () => 'OpenCode, Bun',
    does: 'Open',
    press: () => void openLicences(),
  },
]
registerSettingFields({
  section: 'general',
  group: 'Updates',
  load: () => Promise.resolve(() => (isDesktop ? fields : [])),
})
