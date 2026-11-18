;(function () {
  if (window.top !== window) return
  const BARS =
    'html::-webkit-scrollbar{width:12px;height:12px;background:transparent}' +
    'html::-webkit-scrollbar-track{background:transparent}' +
    'html::-webkit-scrollbar-track:horizontal{margin:0 18px}' +
    'html::-webkit-scrollbar-track:vertical{margin:0 0 18px}' +
    'html::-webkit-scrollbar-thumb{background-color:rgba(128,128,128,0.55);border:3px solid transparent;border-radius:6px;background-clip:padding-box}' +
    'html::-webkit-scrollbar-thumb:hover{background-color:rgba(128,128,128,0.8)}' +
    'html::-webkit-scrollbar-corner{background:transparent}' +
    'html::-webkit-scrollbar-button{display:none}'
  function lay() {
    const root = document.documentElement
    if (!root || !document.body) return
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:absolute;top:-1000px;left:-1000px;width:100px;height:100px;overflow:scroll;visibility:hidden'
    document.body.appendChild(probe)
    const taken = probe.offsetWidth - probe.clientWidth
    probe.remove()
    if (taken <= 0) return
    const style = document.createElement('style')
    style.textContent = BARS
    ;(document.head || root).appendChild(style)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lay, { once: true })
  } else {
    lay()
  }
})()
