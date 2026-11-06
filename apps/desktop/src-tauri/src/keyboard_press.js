;(function () {
  if (window.top !== window) return
  window.addEventListener(
    'pointerdown',
    () => {
      const internals = window.__TAURI_INTERNALS__
      if (internals && typeof internals.invoke === 'function') {
        internals.invoke('keyboard_pressed').catch(() => null)
      }
    },
    true,
  )
})()
