// A press in the app's own page, said to the crate as it lands, so the page's browser is
// given the keyboard outright. On X11 a window's keyboard otherwise follows the pointer
// between its child windows, and a web tab's page is one of them: the pointer crossing
// the page took the keyboard from a menu just opened over it, which closed. See
// keyboard.rs.
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
