// What draws the app's own page, said to the crate once the page has settled: the
// renderer WebGL names, which is the graphics card where the GPU is used and a software
// one where Chromium fell back to drawing on the CPU. See gpu.rs.
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
  // Late, so a launch is not slowed by it: a context made and let go of.
  window.addEventListener('load', () => setTimeout(report, 3000), { once: true })
})()
