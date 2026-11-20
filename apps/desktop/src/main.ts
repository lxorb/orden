import './lib/backend-ports'
import { isDesktop, isMobile, platform, serveAssets, mark, markPainted, watchFirstInput } from './lib/platform/src/api'
import './lib/launch/src/renamed.svelte'
import './lib/sync-base-ports'
import './lib/sync-ports'
import './lib/theme-ports'
import './lib/sharing-ports'
import './lib/terminal-ports'
import './lib/plane-ports'
import './lib/chat-ports'
import './lib/workspace-ports'
import './lib/features'
import '@orden/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { watchPresses } from './lib/downloads/src/api'
import { holdComposingKeys } from './lib/ui-kit/src/api'

mark('modules evaluated')
serveAssets()
Object.assign(window, { ordenBuild: __EVEN_BUILD__ })
if (isMobile) {
  const meta = document.querySelector('meta[name="viewport"]')
  meta?.setAttribute('content', `${meta.getAttribute('content')}, maximum-scale=1, user-scalable=no`)
}
document.documentElement.toggleAttribute('data-engine-bars', isDesktop && platform() === 'linux')
document.documentElement.toggleAttribute('data-skips-unseen', 'userAgentData' in navigator)
const target = document.getElementById('app')
if (!target) throw new Error('index.html has no #app to mount into')
if (isMobile && (await (await import('./lib/workspace/src/moved')).spacesMoved())) {
  location.reload()
  await new Promise<never>(() => undefined)
}
if ((window as { ordenOldDatabases?: boolean }).ordenOldDatabases) {
  await (await import('./lib/handoff/src/api')).carryOldDatabases().catch(() => undefined)
}
const outside: unknown = await (window as { ordenOutside?: Promise<unknown> }).ordenOutside
if (isDesktop && typeof outside === 'string' && (await (await import('./lib/workspace/src/outside')).takeIn())) {
  location.reload()
  await new Promise<never>(() => undefined)
}
if (isDesktop && (await (await import('./lib/workspace/src/former-home')).finishFormerHome())) {
  location.reload()
  await new Promise<never>(() => undefined)
}
const demo = document.documentElement.dataset.demo ? (await import('./lib/demo/src/api')).demoRun : null
if (demo) await (await demo()).seed()
mark('mounting')
watchFirstInput()
watchPresses()
holdComposingKeys()
const app = mount(App, { target })
markPainted('shell painted')
if (demo) void demo().then((run) => run.play())
export default app
