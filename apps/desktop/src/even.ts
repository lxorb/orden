import './lib/backend-ports'
import { serveAssets } from './lib/platform/src/api'
import './lib/sync-ports'
import './lib/sharing-ports'
import './lib/plane-ports'
import './lib/workspace-ports'
import './lib/features'
import { bridge, everywhere, filling, Glasses, seedFlag } from './lib/even/src/api'
import '@orden/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { account } from './lib/accounts/src/api'
import { holdComposingKeys } from './lib/ui-kit/src/api'
import { glassesOn } from './lib/gates/src/api'
import { recovery } from './lib/history/src/api'
import { rememberSeedIn } from './lib/seeded/src/api'
import { sync } from './lib/sync-store/src/api'
import { workspace } from './lib/workspace/src/api'

serveAssets()
holdComposingKeys()

const target = document.getElementById('app')
if (!target) throw new Error('even.html has no #app to mount into')

document.getElementById('boot')?.remove()

account.alsoKeepIn(everywhere)

rememberSeedIn(seedFlag)

void filling.then(() => {
  workspace.device.reread()
  workspace.folderIcons.reread()
  workspace.arranged.reread()
  workspace.graphSettings.reread()
  workspace.sorting.reread()
  workspace.excluded.reread()
  workspace.archive.reread()
  sync.reread()
  recovery.restore()
})

const app = mount(App, { target })
const frame = mount(Glasses, { target })
bridge.startWhile(glassesOn)

export default { app, frame }
