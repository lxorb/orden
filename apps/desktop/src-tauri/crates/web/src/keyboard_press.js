;(function () {
  if (window.top !== window) return
  const tell = (name) => () => {
    const internals = window.__TAURI_INTERNALS__
    if (internals && typeof internals.invoke === 'function') {
      internals.invoke(name).catch(() => null)
    }
  }
  window.addEventListener('pointerdown', tell('keyboard_pressed'), true)
  window.addEventListener('pointerup', tell('keyboard_released'), true)
  window.addEventListener('pointercancel', tell('keyboard_released'), true)
})()
