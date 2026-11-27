import './lib/backend-ports'
import './lib/sync-base-ports'
import './lib/no-workspace-ports'
import '@orden/themes'
import { mount } from 'svelte'
import { account } from './lib/accounts/src/api'
import { startup } from './lib/launch/src/api'
import { theme } from './lib/theme/src/api'
import { loadTrackApp, TrackNav } from './lib/track-app/src/api'
import { viewport } from './lib/ui-kit/src/api'

viewport.start()
theme.init()
void account.restore()
const target = document.getElementById('app')
if (!target) throw new Error('track.html has no #app to mount into')
const nav = new TrackNav()
const [{ default: TrackApp }, screens] = await Promise.all([
  loadTrackApp(),
  import('./lib/time/src/track/screens'),
  import('./lib/time/src/start.svelte'),
])
if (__DRIVEABLE__) {
  Object.assign(window, {
    ordenApp: { account, nav, time: () => import('./lib/time/src/time.svelte').then((one) => one.time) },
  })
}
const app = mount(TrackApp, { target, props: { screens, nav } })
void startup.shown()
export default app
