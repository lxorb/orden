;(function () {
  if (window.top !== window) return
  const BAND = 24
  const EVERY = 400
  let near = false
  let last = -Infinity

  addEventListener(
    'pointermove',
    function (event) {
      if (!event.isTrusted || event.buttons !== 0 || event.pointerType === 'touch') return
      const seen = visualViewport
      const left = seen ? seen.offsetLeft : 0
      const top = seen ? seen.offsetTop : 0
      const width = seen ? seen.width : innerWidth
      const height = seen ? seen.height : innerHeight
      const x = event.clientX - left
      const y = event.clientY - top
      const edge = x <= BAND || y <= BAND || x >= width - BAND || y >= height - BAND
      if (!edge && !near && event.timeStamp - last < EVERY) return
      near = edge
      last = event.timeStamp
      const bound = globalThis.ordenPointed
      if (typeof bound === 'function') bound(JSON.stringify({ x: x / width, y: y / height }))
    },
    { capture: true, passive: true },
  )
})()
