// The app's page's own pixel ratio, said to the crate as the page starts and whenever it
// changes, its zoom included: where a web tab's page goes is what the page measured
// times it. See page_scale.rs.
;(function () {
  if (window.top !== window) return
  let said = 0
  function say() {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') return false
    if (devicePixelRatio !== said) {
      said = devicePixelRatio
      internals.invoke('page_scale_seen', { ratio: said }).catch(() => null)
    }
    return true
  }
  // A change of ratio is a media query that stops matching; the next is asked for then.
  function watch() {
    say()
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', watch, {
      once: true,
    })
  }
  if (!say()) document.addEventListener('DOMContentLoaded', say, { once: true })
  watch()
})()
