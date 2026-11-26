import { isNative } from './tauri'

export function serveAssets(): void {
  if (isNative) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .then((held) => held.active?.postMessage({ ordenKeep: codeLoaded() }))
    .catch(() => undefined)
}
const BUILT = '/assets/'
const codeLoaded = (): string[] =>
  performance
    .getEntriesByType('resource')
    .map((one) => new URL(one.name))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith(BUILT))
    .map((url) => url.pathname)
