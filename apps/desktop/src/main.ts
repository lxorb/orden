import './lib/former-keys'
import './lib/renamed.svelte'
import '@orden/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { mark, markPainted, watchFirstInput } from './lib/trace'
import { serveAssets } from './lib/web/asset-worker'
import { isDesktop, isMobile, platform } from './lib/tauri'
import { watchPresses } from './lib/downloads/started'

mark('modules evaluated')

serveAssets()

Object.assign(window, { nibBuild: __EVEN_BUILD__ })

if (isMobile) {
  const meta = document.querySelector('meta[name="viewport"]')
  meta?.setAttribute(
    'content',
    `${meta.getAttribute('content')}, maximum-scale=1, user-scalable=no`,
  )
}

document.documentElement.toggleAttribute('data-engine-bars', isDesktop && platform() === 'linux')
document.documentElement.toggleAttribute('data-skips-unseen', 'userAgentData' in navigator)

const target = document.getElementById('app')
if (!target) throw new Error('index.html has no #app to mount into')

if (isMobile && (await (await import('./lib/workspace/moved')).spacesMoved())) {
  location.reload()
  await new Promise<never>(() => undefined)
}

const outside: unknown = await (window as { nibOutside?: Promise<unknown> }).nibOutside
if (
  isDesktop &&
  typeof outside === 'string' &&
  (await (await import('./lib/workspace/outside')).takeIn())
) {
  location.reload()
  await new Promise<never>(() => undefined)
}

mark('mounting')

watchFirstInput()

watchPresses()

const app = mount(App, { target })

markPainted('shell painted')

export default app
