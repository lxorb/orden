;(function () {
  const invoke = (args) => window.__TAURI_INTERNALS__.invoke('window_move_resize', args)

  let wrapped = false
  function wrap() {
    const internals = window.__TAURI_INTERNALS__
    if (wrapped || !internals || typeof internals.invoke !== 'function') return
    wrapped = true
    const own = internals.invoke.bind(internals)
    internals.invoke = (cmd, ...rest) =>
      cmd === 'plugin:window|start_dragging' ? Promise.resolve() : own(cmd, ...rest)
  }

  function frame() {
    const internals = window.__TAURI_INTERNALS__
    if (internals && typeof internals.invoke === 'function') {
      internals.invoke('window_frame').catch(() => null)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', frame)
  else frame()

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

  let filling = false
  function measure() {
    filling = window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight
  }
  window.addEventListener('resize', measure)
  measure()

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

  const THRESHOLD = 4
  let pressed = null
  window.addEventListener(
    'mousedown',
    (event) => {
      pressed = null
      wrap()
      if (event.button !== 0 || !event.isTrusted) return
      const edge = filling ? null : edgeAt(event.clientX, event.clientY)
      if (edge) {
        event.preventDefault()
        event.stopImmediatePropagation()
        invoke({ edge })
        return
      }
      if (event.detail === 1 && dragRegion(event.composedPath())) {
        pressed = { x: event.screenX, y: event.screenY }
      }
    },
    true,
  )
  window.addEventListener(
    'mousemove',
    (event) => {
      if (!pressed) return
      if (!(event.buttons & 1)) {
        pressed = null
        return
      }
      if (Math.hypot(event.screenX - pressed.x, event.screenY - pressed.y) < THRESHOLD) return
      const at = {
        x: Math.round(pressed.x * devicePixelRatio),
        y: Math.round(pressed.y * devicePixelRatio),
      }
      pressed = null
      invoke({ edge: null, at })
    },
    true,
  )
  window.addEventListener('mouseup', () => (pressed = null), true)
})()
