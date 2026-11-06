;(function () {
  if (self.origin !== 'null') return

  const block = document.getElementById('nib-block')
  if (block && block.getAttribute('type') === 'application/json') {
    runBlock(JSON.parse(block.textContent))
  }

  const program = document.getElementById('nib-frame')
  if (program && program.getAttribute('type') === 'text/plain') {
    ;(0, eval)(program.textContent)
  }

  function runBlock(html) {
    const holder = document.createElement('template')
    holder.innerHTML = html
    const scripts = Array.from(holder.content.querySelectorAll('script'))
    document.body.insertBefore(holder.content, document.body.firstChild)

    const modules = []
    for (const script of scripts) {
      const kind = kindOf(script)
      if (kind === null) continue

      if (script.hasAttribute('src')) fetchAfresh(script)
      else if (kind === 'module') modules.push(script)
      else run(script, false)
    }

    for (const script of modules) run(script, true)
  }

  function kindOf(script) {
    const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
    if (type === 'module') return 'module'
    if (script.hasAttribute('nomodule')) return null
    if (type === '' || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type)) {
      return 'classic'
    }

    return null
  }

  function fetchAfresh(script) {
    const fresh = document.createElement('script')
    for (const { name, value } of Array.from(script.attributes)) fresh.setAttribute(name, value)
    fresh.async = false
    script.replaceWith(fresh)
  }

  function run(script, asModule) {
    const current = asModule ? null : script
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => current })
    try {
      if (asModule) {
        const Async = Object.getPrototypeOf(async () => undefined).constructor
        new Async(`'use strict';\n${script.textContent}`)().catch(failed)
      } else {
        ;(0, eval)(script.textContent)
      }
    } catch (error) {
      failed(error)
    } finally {
      delete document.currentScript
    }
  }

  function failed(error) {
    if (typeof self.reportError === 'function') self.reportError(error)
    else
      setTimeout(() => {
        throw error
      })
  }
})()
