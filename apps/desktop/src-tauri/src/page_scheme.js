// The app's scheme, light or dark, said to the crate as the app's page starts and each
// time the reader changes it, so a web tab's page is drawn in it rather than in the
// system's. The app wears it on its root as `data-theme`. See page_scheme.rs.
;(function () {
  if (window.top !== window) return
  let said = null
  function say() {
    const scheme = document.documentElement.dataset.theme
    const internals = window.__TAURI_INTERNALS__
    if (scheme !== 'light' && scheme !== 'dark') return
    if (scheme === said || !internals || typeof internals.invoke !== 'function') return
    said = scheme
    internals.invoke('page_scheme_seen', { scheme }).catch(() => (said = null))
  }
  new MutationObserver(say).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  document.addEventListener('DOMContentLoaded', say, { once: true })
  window.addEventListener('load', say, { once: true })
  say()
})()
