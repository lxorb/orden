;(function () {
  if (self.origin !== 'null' || self.parent !== self.top) return

  const evaluate = self.eval
  const Async = Object.getPrototypeOf(async () => undefined).constructor

  const block = document.getElementById('nib-block')
  if (block && block.getAttribute('type') === 'application/json') {
    runBlock(JSON.parse(block.textContent))
  }

  const program = document.getElementById('nib-frame')
  if (program && program.getAttribute('type') === 'text/plain') {
    evaluate(program.textContent)
  }

  function runBlock(html) {
    const holder = document.createElement('template')
    holder.innerHTML = html
    const scripts = Array.from(holder.content.querySelectorAll('script'))
    document.body.insertBefore(holder.content, document.body.firstChild)
    lock()

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
        new Async(`'use strict';\n${script.textContent}`)().catch(failed)
      } else {
        evaluate(script.textContent)
      }
    } catch (error) {
      failed(error)
    } finally {
      delete document.currentScript
    }
  }

  function lock() {
    const loops = /\b(?:for|while|do)\b/
    const refuse = (text) => {
      if (loops.test(text)) {
        throw new EvalError(
          'Orden runs no loop in code made from text: it could not stop one that never ends',
        )
      }
    }

    const own = (where, name, value) =>
      Object.defineProperty(where, name, { configurable: true, writable: true, value })

    own(self, 'eval', function (code) {
      if (typeof code === 'string') refuse(code)
      return evaluate(code)
    })

    const kinds = [
      () => undefined,
      async () => undefined,
      function* () {
        yield
      },
      async function* () {
        yield
      },
    ]
    for (const kind of kinds) {
      const prototype = Object.getPrototypeOf(kind)
      const Native = prototype.constructor
      const Locked = function (...parts) {
        refuse(parts.map(String).join('\n'))
        return Reflect.construct(Native, parts)
      }
      Locked.prototype = prototype
      own(prototype, 'constructor', Locked)
      if (Native === Function) own(self, 'Function', Locked)
    }

    for (const name of ['setTimeout', 'setInterval']) {
      const native = self[name]
      own(self, name, function (handler, ...rest) {
        if (typeof handler !== 'function') refuse(String(handler))
        return native.call(self, handler, ...rest)
      })
    }

    delete self.WebAssembly

    const request = self.XMLHttpRequest && self.XMLHttpRequest.prototype
    if (request) {
      const open = request.open
      own(request, 'open', function (...parts) {
        if (parts.length > 2 && !parts[2]) {
          throw new DOMException('Orden waits on no request in a block', 'InvalidAccessError')
        }
        return open.apply(this, parts)
      })
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
