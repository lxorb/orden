import { ASSET_ROUTE, isNative } from '../platform/src/api'

export function serveAssets(): void {
  if (isNative) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', drawAgain)

  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
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
  }
}
