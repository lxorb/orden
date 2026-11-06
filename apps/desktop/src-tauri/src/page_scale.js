;(function () {
  if (window.top !== window) return
  let said = 0
  function say(again) {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') return false
    if (again || devicePixelRatio !== said) {
      said = devicePixelRatio
      internals.invoke('page_scale_seen', { ratio: said }).catch(() => null)
    }
    return true
  }
  function watch() {
    say(false)
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', watch, {
      once: true,
    })
  }
  if (!say(false)) document.addEventListener('DOMContentLoaded', () => say(false), { once: true })
  window.addEventListener('load', () => {
    say(true)
    setTimeout(() => say(true), 2000)
  })
  watch()
})()
