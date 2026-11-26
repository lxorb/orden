const CODE = 'orden-code-'
const PAGES = 'orden-pages'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(leave()))
async function leave() {
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys()) {
      if (name === PAGES || name.startsWith(CODE)) await caches.delete(name)
    }
  }
  await self.registration.unregister()
}
