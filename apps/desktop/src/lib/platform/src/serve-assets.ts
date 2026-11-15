import { ASSET_ROUTE } from './asset-route'
import { isNative } from './tauri'

export function serveAssets(): void {
  if (isNative) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', drawAgain)

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .then((held) => held.active?.postMessage({ ordenKeep: codeLoaded() }))
    .catch(() => undefined)
}

const BUILT = '/assets/'

function codeLoaded(): string[] {
  const loaded: string[] = []
  for (const one of performance.getEntriesByType('resource')) {
    const url = new URL(one.name)
    if (url.origin === location.origin && url.pathname.startsWith(BUILT)) loaded.push(url.pathname)
  }
  return loaded
}

function drawAgain(): void {
  const under = `[src^="${ASSET_ROUTE}"]`
  const found = document.querySelectorAll(
    `img${under}, audio${under}, video${under}, source${under}`,
  )

  for (const one of found) {
    if (
      !(one instanceof HTMLImageElement) &&
      !(one instanceof HTMLMediaElement) &&
      !(one instanceof HTMLSourceElement)
    ) {
      continue
    }

    const { src } = one
    one.src = ''
    one.src = src
    if (one instanceof HTMLSourceElement && one.parentElement instanceof HTMLMediaElement) {
      one.parentElement.load()
    }
  }
}
