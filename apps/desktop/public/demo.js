;(function (into) {
  const asked = new URLSearchParams(into.location.search).get('demo')
  if (asked === null) return
  const mode = asked === 'phone' ? 'phone' : 'desktop'
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
  const databases = into.indexedDB
  const cleared = new Set()
  function named(name) {
    const full = PREFIX + name
    if (!cleared.has(full)) {
      cleared.add(full)
      databases.deleteDatabase(full)
    }
    return full
  }
  place('localStorage', held(KEPT))
  place('sessionStorage', held({}))
  place('indexedDB', {
    open(name, version) {
      return version === undefined ? databases.open(named(name)) : databases.open(named(name), version)
    },
    deleteDatabase(name) {
      return databases.deleteDatabase(named(name))
    },
    databases() {
      return databases.databases().then(function (all) {
        return all
          .filter(function (one) {
            return typeof one.name === 'string' && one.name.indexOf(PREFIX) === 0
          })
          .map(function (one) {
            return { name: one.name.slice(PREFIX.length), version: one.version }
          })
      })
    },
    cmp(a, b) {
      return databases.cmp(a, b)
    },
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
  const root = into.document.documentElement
  root.dataset.theme = into.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  root.style.background = ''
  root.dataset.demo = mode
})(window)
