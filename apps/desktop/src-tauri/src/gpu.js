;(function () {
  if (window.top !== window) return
  function report() {
    let renderer = null
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl')
      if (gl) {
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
      }
    } catch {
      renderer = null
    }
    const internals = window.__TAURI_INTERNALS__
    if (internals && typeof internals.invoke === 'function') {
      internals.invoke('gpu_seen', { renderer }).catch(() => null)
    }
  }
  window.addEventListener('load', () => setTimeout(report, 3000), { once: true })
})()
