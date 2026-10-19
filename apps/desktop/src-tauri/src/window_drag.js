// The window moved by its tab strip and resized by its edges on Linux, where the press
// never reaches GTK: see window_drag.rs. Run in the app's own page before anything of
// its own, so it hears a press before Tauri's drag script, whose `start_dragging`
// answers nothing there.
;(function () {
  const invoke = (args) => window.__TAURI_INTERNALS__.invoke('window_move_resize', args)

  // Tauri's own rule for a drag region (its drag.js), so the same presses move the window.
  const ATTR = 'data-tauri-drag-region'
  const CLICKABLE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'])
  const ROLES = new Set([
    'button',
    'link',
    'menuitem',
    'tab',
    'checkbox',
    'radio',
    'switch',
    'option',
  ])
  function clickable(el) {
    return (
      CLICKABLE.has(el.tagName) ||
      (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') ||
      (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') ||
      ROLES.has(el.getAttribute('role'))
    )
  }
  function dragRegion(path) {
    for (const el of path) {
      if (!(el instanceof HTMLElement)) continue
      const attr = el.getAttribute(ATTR)
      if (clickable(el) && attr === null) return false
      if (attr === null) continue
      if (attr === 'false') return false
      if (attr === 'deep') return true
      if (attr === '' || attr === 'true') return el === path[0]
    }
    return false
  }

  // The edges a border would have, in the page's own pixels: a little wider at the
  // corners, where a hand aims for less.
  const EDGE = 5
  const CORNER = 14
  function edgeAt(x, y) {
    if (window.innerWidth <= 0 || document.fullscreenElement) return null
    const w = window.innerWidth
    const h = window.innerHeight
    const top = y < EDGE
    const bottom = y >= h - EDGE
    const left = x < EDGE
    const right = x >= w - EDGE
    const nearTop = y < CORNER
    const nearBottom = y >= h - CORNER
    const nearLeft = x < CORNER
    const nearRight = x >= w - CORNER
    if ((top && nearLeft) || (left && nearTop)) return 'nw'
    if ((top && nearRight) || (right && nearTop)) return 'ne'
    if ((bottom && nearLeft) || (left && nearBottom)) return 'sw'
    if ((bottom && nearRight) || (right && nearBottom)) return 'se'
    if (top) return 'n'
    if (bottom) return 's'
    if (left) return 'w'
    if (right) return 'e'
    return null
  }
  const CURSORS = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  }

  // Whether the window fills the screen, where it has no edges to take.
  let filling = false
  function measure() {
    filling = window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight
  }
  window.addEventListener('resize', measure)
  measure()

  // The cursor a border shows, over everything at the edge.
  let shown = null
  let style = null
  function cursor(edge) {
    if (edge === shown) return
    shown = edge
    if (!style) {
      style = document.createElement('style')
      ;(document.head || document.documentElement).appendChild(style)
    }
    style.textContent = edge ? `*{cursor:${CURSORS[edge]}!important}` : ''
  }
  window.addEventListener(
    'mousemove',
    (event) => cursor(filling || event.buttons ? null : edgeAt(event.clientX, event.clientY)),
    true,
  )
  document.addEventListener('mouseleave', () => cursor(null))

  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0 || !event.isTrusted) return
      const edge = filling ? null : edgeAt(event.clientX, event.clientY)
      if (edge) {
        event.preventDefault()
        event.stopImmediatePropagation()
        invoke({ edge })
        return
      }
      // A double click is Tauri's, which maximises the window. A press is left to go
      // on to the page's own handlers as it always went, and to Tauri's script, whose
      // `start_dragging` does nothing here.
      if (event.detail === 1 && dragRegion(event.composedPath())) invoke({ edge: null })
    },
    true,
  )
})()
