// The extension API a Firefox add-on's background page sees, in the offscreen document it
// runs as; see host.js. An offscreen document has the engine's messaging and nothing else,
// so `chrome` here is the engine's own `runtime` and, for everything past it, a stand-in
// that sends each call to the service worker over a port and each event back from it. A
// call answers as the engine's own do: a promise, or the callback it was handed with
// `runtime.lastError` set for a refusal, which is what the WebExtension polyfill after
// this wraps into `browser`.
;(function () {
  if (globalThis.__ordenBridge) return
  globalThis.__ordenBridge = true
  globalThis.__ordenBackground = true

  const native = globalThis.chrome
  const PORT = '__orden'

  // The namespaces that hold namespaces rather than functions, by the namespace they are in.
  const INSIDE = {
    storage: ['local', 'sync', 'session', 'managed'],
    privacy: ['network', 'services', 'websites'],
    proxy: ['settings'],
    devtools: ['inspectedWindow', 'network', 'panels'],
    contentSettings: [
      'automaticDownloads',
      'camera',
      'cookies',
      'images',
      'javascript',
      'location',
      'microphone',
      'notifications',
      'plugins',
      'popups',
    ],
    browserSettings: [],
  }
  // Where every name is a setting, itself a namespace of `get`, `set` and `clear`.
  const SETTINGS = new Set([
    'privacy.network',
    'privacy.services',
    'privacy.websites',
    'browserSettings',
  ])
  // The engine's constants a background page reads, which a call cannot answer.
  const CONSTANTS = {
    'tabs.TAB_ID_NONE': -1,
    'tabs.TAB_INDEX_NONE': -1,
    'windows.WINDOW_ID_NONE': -1,
    'windows.WINDOW_ID_CURRENT': -2,
    'contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT': 6,
    'menus.ACTION_MENU_TOP_LEVEL_LIMIT': 6,
    'storage.local.QUOTA_BYTES': 10485760,
    'storage.sync.QUOTA_BYTES': 102400,
    'storage.sync.QUOTA_BYTES_PER_ITEM': 8192,
    'storage.sync.MAX_ITEMS': 512,
    'storage.session.QUOTA_BYTES': 10485760,
    'alarms.MINIMUM_PERIOD_IN_MINUTES': 0.5,
  }

  let port = null
  let next = 0
  const waiting = new Map()
  const listening = new Map()

  function connect() {
    port = native.runtime.connect({ name: PORT })
    port.onMessage.addListener((said) => {
      if (said.kind === 'answer') {
        const one = waiting.get(said.id)
        waiting.delete(said.id)
        if (!one) return
        if ('error' in said) one.refuse(new Error(said.error))
        else one.answer(said.value)
      } else if (said.kind === 'event') {
        const one = listening.get(said.key)
        if (one) for (const listener of [...one.listeners]) listener(...(said.args ?? []))
      } else if (said.kind === 'refused') {
        console.error(`Listening to ${listening.get(said.key)?.name}:`, said.error)
      }
    })
    port.onDisconnect.addListener(() => {
      port = null
      for (const one of waiting.values()) one.refuse(new Error('The extension restarted.'))
      waiting.clear()
      // The worker stopped; it is started again, and told again what the page listens to.
      setTimeout(() => {
        if (port || listening.size === 0) return
        connect()
        for (const [key, one] of listening)
          send({ kind: 'listen', key, path: one.path, extra: one.extra })
      }, 0)
    })
  }

  function send(message) {
    if (!port) connect()
    port.postMessage(message)
  }

  function ask(path, args) {
    while (args.length && args[args.length - 1] === undefined) args.pop()
    return new Promise((answer, refuse) => {
      const id = ++next
      waiting.set(id, { answer, refuse })
      try {
        send({ kind: 'call', id, path, args })
      } catch (error) {
        waiting.delete(id)
        refuse(error)
      }
    })
  }

  function call(path) {
    return function (...args) {
      const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null
      const answered = ask(path, args)
      if (!callback) return answered
      answered.then(
        (value) => callback(value),
        (error) => {
          globalThis.__ordenLastError = { message: error.message }
          try {
            callback()
          } finally {
            globalThis.__ordenLastError = undefined
          }
        },
      )
      return undefined
    }
  }

  function event(path) {
    const name = path.join('.')
    return {
      addListener(listener, ...extra) {
        if (typeof listener !== 'function') return
        let key = [...listening].find(
          ([, one]) => one.name === name && JSON.stringify(one.extra) === JSON.stringify(extra),
        )?.[0]
        if (!key) {
          key = `${name}#${++next}`
          listening.set(key, { name, path, extra, listeners: new Set() })
          send({ kind: 'listen', key, path, extra })
        }
        listening.get(key).listeners.add(listener)
      },
      removeListener(listener) {
        for (const [key, one] of listening) {
          if (one.name !== name || !one.listeners.delete(listener) || one.listeners.size) continue
          listening.delete(key)
          if (port) send({ kind: 'unlisten', key })
        }
      },
      hasListener(listener) {
        return [...listening.values()].some(
          (one) => one.name === name && one.listeners.has(listener),
        )
      },
      hasListeners() {
        return [...listening.values()].some((one) => one.name === name && one.listeners.size > 0)
      },
    }
  }

  // A menu item's id, which Firefox answers at once, and what pressing it runs, which no
  // port carries.
  let items = 0
  const pressed = new Map()
  let hearing = false
  function menu(path) {
    return function (properties = {}, callback) {
      const id = properties.id ?? `orden-menu-${++items}`
      const { onclick, ...rest } = properties
      if (typeof onclick === 'function') {
        pressed.set(id, onclick)
        if (!hearing) {
          hearing = true
          event([path[0], 'onClicked']).addListener((info, tab) =>
            pressed.get(info.menuItemId)?.(info, tab),
          )
        }
      }
      ask([...path, 'create'], [{ ...rest, id }]).then(
        () => callback?.(),
        (error) => {
          globalThis.__ordenLastError = { message: error.message }
          try {
            callback?.()
          } finally {
            globalThis.__ordenLastError = undefined
          }
        },
      )
      return id
    }
  }

  /** A namespace: what is asked of it is made the first time and kept. */
  function namespace(path) {
    const made = {}
    const dotted = path.join('.')
    return new Proxy(made, {
      has: (_, name) => typeof name === 'string',
      get(target, name) {
        if (typeof name !== 'string' || name === 'then' || name === 'toJSON') return target[name]
        if (name in target) return target[name]
        const inner = [...path, name]
        const at = inner.join('.')
        let value
        if (path.length === 0) value = namespace(inner)
        else if (at in CONSTANTS) value = CONSTANTS[at]
        else if (/^[A-Z][A-Z0-9_]*$/.test(name))
          value = /^[A-Z]/.test(path[path.length - 1]) ? name.toLowerCase() : undefined
        else if (/^on[A-Z]/.test(name)) value = event(inner)
        else if (/^[A-Z]/.test(name) || SETTINGS.has(dotted) || INSIDE[dotted]?.includes(name))
          value = namespace(inner)
        else if (name === 'create' && (dotted === 'menus' || dotted === 'contextMenus'))
          value = menu(path)
        else value = call(inner)
        target[name] = value
        return value
      },
    })
  }

  /** One of the extension's own files as JSON, at once: what `runtime` and `i18n` answer
   *  without waiting is read out of them. */
  function read(path) {
    try {
      const asked = new XMLHttpRequest()
      asked.open('GET', path, false)
      asked.send()
      return asked.status === 200 || asked.status === 0 ? JSON.parse(asked.responseText) : null
    } catch {
      return null
    }
  }

  // The engine's own messaging, with the rest of `runtime` from the worker.
  const nativeRuntime = native.runtime
  const manifest = read('/manifest.json') ?? {}
  const own = {
    getManifest: () => JSON.parse(JSON.stringify(globalThis.__ordenLayer?.manifest ?? manifest)),
    getURL: (path) => new URL(String(path), location.origin).href,
    getBackgroundPage: (callback) => {
      if (callback) callback(window)
      return Promise.resolve(window)
    },
  }
  const runtime = new Proxy(
    {},
    {
      has: (_, name) => typeof name === 'string',
      get(target, name) {
        if (name === 'lastError') return globalThis.__ordenLastError ?? nativeRuntime.lastError
        if (name in target) return target[name]
        if (name in nativeRuntime) {
          const value = nativeRuntime[name]
          return typeof value === 'function' ? value.bind(nativeRuntime) : value
        }
        if (name in own) target[name] = own[name]
        else if (typeof name === 'string' && /^on[A-Z]/.test(name))
          target[name] = event(['runtime', name])
        else target[name] = call(['runtime', name])
        return target[name]
      },
      set(target, name, value) {
        target[name] = value
        return true
      },
    },
  )

  // `i18n` answers at once, so its words are read once, here, out of the extension's own files.
  const words = (() => {
    const wanted = navigator.language.replace('-', '_')
    const found = {}
    for (const language of [manifest.default_locale, wanted.split('_')[0], wanted]) {
      if (!language) continue
      const one = read(`/_locales/${language}/messages.json`)
      if (one) for (const [key, entry] of Object.entries(one)) found[key.toLowerCase()] = entry
    }
    return found
  })()

  function message(name, substitutions) {
    if (name === '@@extension_id') return nativeRuntime.id
    if (name === '@@ui_locale') return navigator.language.replace('-', '_')
    if (name === '@@bidi_dir') return document.dir || 'ltr'
    const entry =
      words[
        String(name)
          .replace(/[^A-Za-z0-9_@]/g, '_')
          .toLowerCase()
      ]
    if (!entry) return ''
    const given = substitutions === undefined ? [] : [].concat(substitutions).map(String)
    let text = entry.message ?? ''
    for (const [key, held] of Object.entries(entry.placeholders ?? {})) {
      text = text.replace(new RegExp(`\\$${key}\\$`, 'gi'), held.content ?? '')
    }
    return text.replace(/\$(\d)/g, (_, at) => given[Number(at) - 1] ?? '').replace(/\$\$/g, '$')
  }

  const i18n = native.i18n ?? {
    getMessage: message,
    getUILanguage: () => navigator.language,
    getAcceptLanguages: call(['i18n', 'getAcceptLanguages']),
    detectLanguage: call(['i18n', 'detectLanguage']),
  }

  const extension = {
    getURL: (path) => runtime.getURL(path),
    getBackgroundPage: () => window,
    getViews: () => [window],
    inIncognitoContext: false,
    isAllowedIncognitoAccess: call(['extension', 'isAllowedIncognitoAccess']),
    isAllowedFileSchemeAccess: call(['extension', 'isAllowedFileSchemeAccess']),
  }

  const root = namespace([])
  const chrome = new Proxy(
    { runtime, i18n, extension },
    {
      has: (_, name) => typeof name === 'string',
      get: (target, name) => (name in target ? target[name] : (target[name] = root[name])),
      set(target, name, value) {
        target[name] = value
        return true
      },
    },
  )
  try {
    Object.defineProperty(globalThis, 'chrome', {
      value: chrome,
      configurable: true,
      writable: true,
    })
  } catch {
    globalThis.chrome = chrome
  }
})()
