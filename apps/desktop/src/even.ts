import './lib/former-keys'
import './lib/sharing-ports'
import { bridge, everywhere, filling, Glasses, seedFlag } from './lib/even/src/api'
import '@orden/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { account } from './lib/accounts/src/api'
import { holdComposingKeys } from './lib/ui-kit/src/api'
import { glassesOn } from './lib/settings.svelte'
import { recovery } from './lib/recovery.svelte'
import { rememberSeedIn } from './lib/seeded'
import { sync } from './lib/sync.svelte'
import { serveAssets } from './lib/web/asset-worker'
import { workspace } from './lib/workspace.svelte'

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
