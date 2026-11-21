;(function (into) {
  const params = new URLSearchParams(into.location.search)
  const asked = params.get('demo')
  if (asked === null) return
  const mode = asked === 'phone' || params.has('phone') ? 'phone' : 'desktop'
  const PREFIX = 'orden-demo:'
  const KEPT = {
    'orden:seeded': 'yes',
    'orden:setup': '"done"',
    'orden:first-visit': 'answered',
    'orden:hints': '["drawer","graph","palette"]',
    'orden:renamed': 'told',
    'orden:contrast-offered': 'yes',
    'orden:kept-for-good-asked': 'yes',
    'orden:usage-help': 'false',
    'orden:theme': 'default',
    'orden:theme-moved': 'yes',
    'orden:ai-sidebar': '{"rail":false}',
  }
  const SERVER = /^\/(?:v\d+|themes|api)(?:\/|$)/
  const here = into.location.href
  function held(start) {
    const map = new Map(Object.entries(start))
    return {
      get length() {
        return map.size
      },
      key(index) {
        const keys = Array.from(map.keys())
        return index < keys.length ? keys[index] : null
      },
      getItem(key) {
        return map.has(String(key)) ? map.get(String(key)) : null
      },
      setItem(key, value) {
        map.set(String(key), String(value))
      },
      removeItem(key) {
        map.delete(String(key))
      },
      clear() {
        map.clear()
      },
    }
  }
  function owns(url) {
    try {
      const found = new URL(url, here)
      return found.origin === new URL(here).origin && !SERVER.test(found.pathname)
    } catch (_refused) {
      return false
    }
  }
  function shut() {
    return class extends EventTarget {
      constructor() {
        super()
        this.readyState = 3
        queueMicrotask(() => this.dispatchEvent(new Event('close')))
      }
      send() {
        return false
      }
      close() {
        return this.readyState
      }
    }
  }
  function place(name, value) {
    Object.defineProperty(into, name, { configurable: true, enumerable: true, writable: true, value })
  }
  place('localStorage', held(KEPT))
  place('sessionStorage', held({}))
  function refused() {
    throw new DOMException('The demo keeps nothing in this browser', 'SecurityError')
  }
  function none() {
    return Promise.reject(new DOMException('The demo keeps nothing in this browser', 'SecurityError'))
  }
  place('indexedDB', { open: refused, deleteDatabase: refused, cmp: refused, databases: none })
  if (into.caches) place('caches', { open: none, match: none, has: none, keys: none, delete: none })
  Object.defineProperty(into.navigator, 'storage', {
    configurable: true,
    value: { getDirectory: none, persist: none, persisted: none, estimate: none },
  })
  const Channel = into.BroadcastChannel
  place(
    'BroadcastChannel',
    class extends Channel {
      constructor(name) {
        super(PREFIX + name)
      }
    },
  )
  const workers = into.navigator.serviceWorker
  if (workers)
    Object.defineProperty(workers, 'register', {
      configurable: true,
      value() {
        return new Promise(function () {
          return undefined
        })
      },
    })
  const fetching = into.fetch
  place('fetch', function (input, init) {
    const url = typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input)
    return owns(url) ? fetching.call(into, input, init) : Promise.reject(new TypeError('The demo stays offline'))
  })
  place('WebSocket', shut())
  if (into.EventSource) place('EventSource', shut())
  Object.defineProperty(into.navigator, 'sendBeacon', {
    configurable: true,
    value() {
      return false
    },
  })
  if (mode === 'phone') {
    const media = into.matchMedia
    place('matchMedia', function (query) {
      if (/pointer:\s*coarse|hover:\s*none/.test(query)) return media.call(into, 'all')
      if (/pointer:\s*fine|hover:\s*hover/.test(query)) return media.call(into, 'not all')
      return media.call(into, query)
    })
    Object.defineProperty(into.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })
    Object.defineProperty(into.navigator, 'userAgentData', { configurable: true, value: { mobile: true } })
  }
  if (into.top !== into) {
    for (const Kind of [into.HTMLElement, into.SVGElement]) {
      if (!Kind) continue
      const focusing = Kind.prototype.focus
      Object.defineProperty(Kind.prototype, 'focus', {
        configurable: true,
        writable: true,
        value(options) {
          if (!into.document.hasFocus()) return
          focusing.call(this, Object.assign({}, options, { preventScroll: true }))
        },
      })
    }
    const inside = function () {
      const box = this.getBoundingClientRect()
      for (let around = this.parentElement; around; around = around.parentElement) {
        if (around.scrollHeight <= around.clientHeight && around.scrollWidth <= around.clientWidth) continue
        const room = around.getBoundingClientRect()
        if (box.top < room.top) around.scrollTop -= room.top - box.top
        else if (box.bottom > room.bottom) around.scrollTop += Math.min(box.bottom - room.bottom, box.top - room.top)
        if (box.left < room.left) around.scrollLeft -= room.left - box.left
        else if (box.right > room.right) around.scrollLeft += Math.min(box.right - room.right, box.left - room.left)
        return
      }
    }
    for (const name of ['scrollIntoView', 'scrollIntoViewIfNeeded'])
      if (into.Element && name in into.Element.prototype)
        Object.defineProperty(into.Element.prototype, name, { configurable: true, writable: true, value: inside })
  }
  const root = into.document.documentElement
  root.dataset.theme = into.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  root.style.background = ''
  root.dataset.demo = mode
})(window)
