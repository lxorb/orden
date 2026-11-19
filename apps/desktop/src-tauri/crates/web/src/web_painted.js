;(function () {
  if (window.top !== window) return
  if (typeof PerformanceObserver !== 'function') return
  let told = false
  let grace = null
  const tell = function () {
    if (told) return
    told = true
    if (grace !== null) clearTimeout(grace)
    const bound = globalThis.ordenPainted
    if (typeof bound === 'function') bound(JSON.stringify({ url: location.href }))
  }
  try {
    new PerformanceObserver(function (list, seen) {
      for (const one of list.getEntries()) {
        if (one.name === 'first-contentful-paint') {
          seen.disconnect()
          tell()
          return
        }
        if (one.name === 'first-paint' && grace === null) {
          grace = setTimeout(function () {
            seen.disconnect()
            tell()
          }, 250)
        }
      }
    }).observe({ type: 'paint', buffered: true })
  } catch (error) {
    tell()
  }
})()
