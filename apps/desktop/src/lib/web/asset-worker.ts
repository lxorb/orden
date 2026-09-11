/** Putting the asset worker in front of the page.
 *
 *  One call, from every entry a browser can open, before anything is mounted. The
 *  app itself never mentions it again: the worker answers addresses, and the
 *  addresses are made by `assetUrl` like every other one. See public/sw.js. */

import { ASSET_ROUTE } from './asset-route'
import { isNative } from '../tauri'

export function serveAssets(): void {
  // The app has a disk of its own, on a desktop and on a phone alike, and reaches
  // it through the asset protocol rather than through anything of ours.
  if (isNative) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // A worker takes over a page it did not start with, which on the first visit of
  // all is this page: the pictures resolved before it arrived were asked for and
  // nobody answered, so they are asked again. Every visit after this one is
  // already controlled before the first picture is drawn.
  navigator.serviceWorker.addEventListener('controllerchange', drawAgain)

  // Registration fails by itself where there can be no worker: a page served over
  // plain http, a private window in some browsers. Nothing to say about it - a
  // picture that cannot be fetched shows the placeholder a missing one shows, and
  // there is nothing the reader could do.
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
}

/** Every picture on the page, asked for again. One selector rather than a message
 *  to each surface that draws one: the editor's widget, the reading view, a hover
 *  preview and a card on a plane all end in an element with a `src`, and this is
 *  the one place that knows they share an address. */
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

    // Emptied first: setting the same address again is not a change, and a
    // browser that has already failed to load it would not try twice.
    const { src } = one
    one.src = ''
    one.src = src
  }
}
