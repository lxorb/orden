// What Firefox has and Chromium does not, put on `chrome` before the WebExtension polyfill
// makes `browser` of it, in every context of a Firefox add-on: its service worker, its
// pages, its content scripts; see firefox.rs. Each is the nearest Orden can come: a call
// Chromium makes under another name is made under that name, a call it refuses for a
// Firefox-only argument is made without the argument, and what Orden cannot do at all
// answers the way Firefox answers when it cannot either, with an error that says so. The
// background page's calls are made in the service worker (host.js), so there only what
// cannot cross a port is made here.
;(function () {
  if (globalThis.__ordenFirefox) return
  globalThis.__ordenFirefox = true
  const chrome = globalThis.chrome
  if (!chrome?.runtime?.id) return

  // Chromium's own `browser` is `chrome` without what is put on it here, and a Firefox
  // add-on reads `browser` first: it goes, for the polyfill to make one of `chrome` as it
  // is once this has run.
  try {
    delete globalThis.browser
  } catch {
    globalThis.browser = undefined
  }

  const LAYER = globalThis.__ordenLayer ?? {}
  const worker =
    typeof ServiceWorkerGlobalScope === 'function' && globalThis instanceof ServiceWorkerGlobalScope
  const background = globalThis.__ordenBackground === true
  const page = !worker && !background && globalThis.location?.protocol === 'chrome-extension:'
  const content = !worker && !background && !page
  const full = worker || page

  const DEFAULT_STORE = 'firefox-default'
  const OURS = ['orden/firefox.js', 'orden/browser-polyfill.js']
  /** A list of the add-on's own files with the layer's first, each once. */
  const withOurs = (files) => [
    ...new Set([...OURS, ...files.map((one) => String(one).replace(/^\//, ''))]),
  ]

  // A refusal a callback is handed, as `runtime.lastError`, which is where the polyfill
  // looks for one.
  if (!background) {
    try {
      const own = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError')
      Object.defineProperty(chrome.runtime, 'lastError', {
        configurable: true,
        get: () =>
          globalThis.__ordenLastError ?? (own?.get ? own.get.call(chrome.runtime) : own?.value),
      })
    } catch {
      // An engine that will not have it changed says only its own refusals.
    }
  }

  /** A function that answers a promise, and a callback too when it is handed one. */
  function promised(work) {
    return function (...args) {
      const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null
      const answered = Promise.resolve().then(() => work(...args))
      if (!callback) return answered
      answered.then(callback, (error) => {
        globalThis.__ordenLastError = { message: String(error?.message ?? error) }
        try {
          callback()
        } finally {
          globalThis.__ordenLastError = undefined
        }
      })
      return undefined
    }
  }

  function refused(name) {
    return promised(() => {
      throw new Error(`${name} is not supported in Orden.`)
    })
  }

  /** An event of Orden's own, which the layer fires. */
  function event() {
    const listeners = new Set()
    return {
      addListener: (listener) => void listeners.add(listener),
      removeListener: (listener) => void listeners.delete(listener),
      hasListener: (listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
      fire(...args) {
        for (const listener of [...listeners]) {
          try {
            listener(...args)
          } catch (error) {
            console.error(error)
          }
        }
      },
    }
  }

  function put(on, name, value) {
    if (on && on[name] === undefined) on[name] = value
  }

  /** `on[name]`, wrapped by `wrap`, which is handed the engine's own. */
  function wrapped(on, name, wrap) {
    const own = on?.[name]
    if (typeof own === 'function') on[name] = wrap(own.bind(on))
  }

  /** A listener's events, through `wrap`; the listener can still be taken away. */
  function filtered(on, wrap) {
    if (!on?.addListener) return
    const add = on.addListener.bind(on)
    const remove = on.removeListener.bind(on)
    const has = on.hasListener.bind(on)
    const made = new WeakMap()
    on.addListener = (listener, ...extra) => {
      const one = wrap(listener, extra)
      made.set(listener, one.listener)
      add(one.listener, ...one.extra)
    }
    on.removeListener = (listener) => remove(made.get(listener) ?? listener)
    on.hasListener = (listener) => has(made.get(listener) ?? listener)
  }

  const kept = (area) => ({
    async get(key, fallback) {
      const store = chrome.storage?.[area]
      if (!store) return fallback
      const found = await store.get(key)
      return found[key] ?? fallback
    },
    async set(key, value) {
      await chrome.storage?.[area]?.set({ [key]: value })
    },
  })
  const local = kept('local')
  const session = kept('session')

  // A message by the name Firefox takes, which may have a `-` that Chromium's has not; see
  // `message_name` in firefox.rs.
  const plainName = (name) => String(name).replace(/[^A-Za-z0-9_@]/g, '_')
  if (chrome.i18n?.getMessage && !background) {
    const own = chrome.i18n.getMessage.bind(chrome.i18n)
    chrome.i18n.getMessage = (name, ...rest) => own(plainName(name), ...rest)
  }

  // Its own manifest, as Firefox answers it, rather than the one Chromium was handed.
  if (LAYER.manifest) chrome.runtime.getManifest = () => JSON.parse(JSON.stringify(LAYER.manifest))

  // The browser it is, as an add-on asks Firefox.
  put(
    chrome.runtime,
    'getBrowserInfo',
    promised(() => ({
      name: 'Firefox',
      vendor: 'Mozilla',
      version: LAYER.firefox ?? '140.0',
      buildID: '20250101000000',
    })),
  )

  // An address of its own, as Firefox and Manifest V2 still say it.
  if (chrome.extension) put(chrome.extension, 'getURL', (path) => chrome.runtime.getURL(path))
  else chrome.extension = { getURL: (path) => chrome.runtime.getURL(path) }

  if (page) {
    // A page asking for the background page gets the offscreen document it runs as.
    const backgroundPage = () =>
      chrome.extension.getViews?.().find((view) => view.__ordenBackground === true) ?? null
    chrome.extension.getBackgroundPage = backgroundPage
    chrome.runtime.getBackgroundPage = promised(backgroundPage)
  }

  if (content) {
    // The element a menu was opened on, as `menus.getTargetElement` hands it back.
    let target = null
    document.addEventListener('contextmenu', (event) => (target = event.target), true)
    chrome.menus = { getTargetElement: () => target }
    return
  }

  // A content script registered while the add-on runs, as Firefox's own API does it.
  let registered = 0
  put(chrome, 'contentScripts', {
    register: promised(async (options) => {
      const files = (options.js ?? [])
        .filter((one) => one.file)
        .map((one) => one.file.replace(/^\//, ''))
      if ((options.js ?? []).some((one) => one.code))
        throw new Error('A content script of code is not supported in Orden.')
      const id = `orden-${Date.now()}-${++registered}`
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: options.matches,
          excludeMatches: options.excludeMatches,
          js: files.length ? withOurs(files) : undefined,
          css: (options.css ?? [])
            .filter((one) => one.file)
            .map((one) => one.file.replace(/^\//, '')),
          allFrames: options.allFrames,
          matchOriginAsFallback: options.matchAboutBlank,
          runAt: options.runAt,
          persistAcrossSessions: false,
        },
      ])
      return {
        unregister: promised(() => chrome.scripting.unregisterContentScripts({ ids: [id] })),
      }
    }),
  })

  if (!full) return

  // A permission only Firefox has is one the add-on does not have, rather than a refusal
  // to answer.
  if (chrome.permissions) {
    const FIREFOX_ONLY = new Set([
      'browserSettings',
      'captivePortal',
      'contextualIdentities',
      'dns',
      'find',
      'geckoProfiler',
      'menus.overrideContext',
      'pkcs11',
      'tabHide',
      'telemetry',
      'theme',
      'webRequestBlocking',
      'webRequestFilterResponse',
    ])
    const split = (asked = {}) => {
      const all = asked.permissions ?? []
      const only = all.filter((one) => FIREFOX_ONLY.has(one))
      const rest = {
        ...asked,
        permissions: all
          .filter((one) => !FIREFOX_ONLY.has(one))
          .map((one) => (one === 'menus' ? 'contextMenus' : one)),
      }
      return { only, rest }
    }
    for (const name of ['contains', 'request']) {
      wrapped(chrome.permissions, name, (own) =>
        promised(async (asked) => {
          const { only, rest } = split(asked)
          if (only.length) return false
          return own(rest)
        }),
      )
    }
    wrapped(chrome.permissions, 'remove', (own) =>
      promised(async (asked) => own(split(asked).rest)),
    )
  }

  // The toolbar button by its Manifest V2 names. A page action that became the button
  // shows and hides as the button is turned on and off; one beside a browser action has
  // no button of its own in Chromium, and its calls change nothing.
  if (chrome.action) {
    const action = chrome.action
    wrapped(action, 'setIcon', (own) => (details, ...rest) => {
      const paths =
        typeof details?.path === 'string' ? [details.path] : Object.values(details?.path ?? {})
      if (paths.some((one) => /\.svg(#|$)/i.test(one))) return promised(() => undefined)(...rest)
      return own(details, ...rest)
    })
    put(chrome, 'browserAction', action)
    const asAction = (own) =>
      new Proxy(own, {
        get: (target, name) => {
          if (name in target) return target[name]
          const value = action[name]
          return typeof value === 'function' ? value.bind(action) : value
        },
      })
    const pageAction =
      LAYER.pageAction === 'action'
        ? asAction({
            show: (tabId) => action.enable(tabId),
            hide: (tabId) => action.disable(tabId),
            isShown: ({ tabId }) => action.isEnabled(tabId),
          })
        : {
            show: promised(() => undefined),
            hide: promised(() => undefined),
            isShown: promised(() => false),
            setTitle: promised(() => undefined),
            getTitle: promised(() => ''),
            setIcon: promised(() => undefined),
            setPopup: promised(() => undefined),
            getPopup: promised(() => ''),
            onClicked: event(),
          }
    put(chrome, 'pageAction', pageAction)
  }

  // Menus: `menus` is `contextMenus`, with the places only Firefox has menus in left out.
  if (chrome.contextMenus) {
    const menus = chrome.contextMenus
    const PLACES = { browser_action: 'action', page_action: 'action' }
    const ONLY_FIREFOX = new Set(['tab', 'bookmark', 'tools_menu', 'password', 'inspector'])
    const ours = (pattern) => String(pattern).replace(/^moz-extension:/, 'chrome-extension:')
    const fitted = (properties, creating) => {
      if (!properties || typeof properties !== 'object') return properties
      const out = { ...properties }
      delete out.icons
      delete out.command
      delete out.viewTypes
      if (Array.isArray(out.contexts)) {
        out.contexts = [
          ...new Set(
            out.contexts.filter((one) => !ONLY_FIREFOX.has(one)).map((one) => PLACES[one] ?? one),
          ),
        ]
        // A menu only Firefox has, such as a tab's own, is made and never shown.
        if (!out.contexts.length) out.visible = false
        if (!out.contexts.length) out.contexts = ['page']
      }
      for (const field of ['documentUrlPatterns', 'targetUrlPatterns']) {
        if (Array.isArray(out[field])) out[field] = out[field].map(ours)
      }
      // Firefox draws an item by its icon alone; Chromium will have words.
      if (creating && out.type !== 'separator' && !out.title) out.title = String(out.id ?? '…')
      return out
    }
    wrapped(
      menus,
      'create',
      (own) => (properties, callback) => own(fitted(properties, true), callback),
    )
    wrapped(
      menus,
      'update',
      (own) =>
        (id, properties, ...rest) =>
          own(id, fitted(properties), ...rest),
    )
    filtered(menus.onClicked, (listener, extra) => ({
      listener: (info, tab) => listener({ targetElementId: 1, ...info }, tab),
      extra,
    }))
    put(menus, 'overrideContext', () => undefined)
    put(
      menus,
      'refresh',
      promised(() => undefined),
    )
    put(menus, 'onShown', event())
    put(menus, 'onHidden', event())
    put(menus, 'getTargetElement', () => null)
    put(chrome, 'menus', menus)
  }

  // Containers. Orden's are its spaces' and sites' own stores, which an add-on cannot reach
  // from inside the engine; so an add-on keeps its own, as Firefox's are kept, and a tab
  // opens in the one store it has.
  const IDENTITIES = '__ordenContainers'
  const COLORS = {
    blue: '#37adff',
    turquoise: '#00c79a',
    green: '#51cd00',
    yellow: '#ffcb00',
    orange: '#ff9f00',
    red: '#ff613d',
    pink: '#ff4bda',
    purple: '#af51f5',
    toolbar: '#7c7c7d',
  }
  const identity = (one) => ({
    ...one,
    colorCode: COLORS[one.color] ?? COLORS.toolbar,
    iconUrl: `resource://usercontext-content/${one.icon}.svg`,
  })
  const FIRST = [
    { cookieStoreId: 'firefox-container-1', name: 'Personal', color: 'blue', icon: 'fingerprint' },
    { cookieStoreId: 'firefox-container-2', name: 'Work', color: 'orange', icon: 'briefcase' },
    { cookieStoreId: 'firefox-container-3', name: 'Banking', color: 'green', icon: 'dollar' },
    { cookieStoreId: 'firefox-container-4', name: 'Shopping', color: 'pink', icon: 'cart' },
  ]
  const identities = () => local.get(IDENTITIES, FIRST)
  const containers = {
    onCreated: event(),
    onUpdated: event(),
    onRemoved: event(),
    query: promised(async (details = {}) =>
      (await identities())
        .filter((one) => details.name === undefined || one.name === details.name)
        .filter(
          (one) =>
            details.cookieStoreIds === undefined ||
            details.cookieStoreIds.includes(one.cookieStoreId),
        )
        .map(identity),
    ),
    get: promised(async (id) => {
      const one = (await identities()).find((held) => held.cookieStoreId === id)
      if (!one) throw new Error(`Invalid contextual identity: ${id}`)
      return identity(one)
    }),
    create: promised(async ({ name, color, icon }) => {
      const all = await identities()
      const top = Math.max(0, ...all.map((one) => Number(one.cookieStoreId.split('-').pop()) || 0))
      const one = { cookieStoreId: `firefox-container-${top + 1}`, name, color, icon }
      await local.set(IDENTITIES, [...all, one])
      return identity(one)
    }),
    update: promised(async (id, details) => {
      const all = await identities()
      const at = all.findIndex((one) => one.cookieStoreId === id)
      if (at < 0) throw new Error(`Invalid contextual identity: ${id}`)
      all[at] = { ...all[at], ...details, cookieStoreId: id }
      await local.set(IDENTITIES, all)
      return identity(all[at])
    }),
    remove: promised(async (id) => {
      const all = await identities()
      const one = all.find((held) => held.cookieStoreId === id)
      if (!one) throw new Error(`Invalid contextual identity: ${id}`)
      await local.set(
        IDENTITIES,
        all.filter((held) => held !== one),
      )
      return identity(one)
    }),
    querySiteAssociations: promised(() => []),
    move: promised(async (ids, position) => {
      const all = await identities()
      const moving = all.filter((one) => [].concat(ids).includes(one.cookieStoreId))
      const rest = all.filter((one) => !moving.includes(one))
      rest.splice(position < 0 ? rest.length : position, 0, ...moving)
      await local.set(IDENTITIES, rest)
    }),
  }
  chrome.storage?.onChanged?.addListener((changes, area) => {
    const change = changes[IDENTITIES]
    if (area !== 'local' || !change) return
    const before = change.oldValue ?? FIRST
    const after = change.newValue ?? FIRST
    const of = (list, id) => list.find((one) => one.cookieStoreId === id)
    for (const one of after) {
      const was = of(before, one.cookieStoreId)
      if (!was) containers.onCreated.fire({ contextualIdentity: identity(one) })
      else if (JSON.stringify(was) !== JSON.stringify(one))
        containers.onUpdated.fire({ contextualIdentity: identity(one) })
    }
    for (const one of before) {
      if (!of(after, one.cookieStoreId))
        containers.onRemoved.fire({ contextualIdentity: identity(one) })
    }
  })
  put(chrome, 'contextualIdentities', containers)

  // Tabs: each in the one store, and hidden as Firefox hides them, which in Orden is a
  // tab the add-on itself takes for hidden and the tab bar still shows.
  const HIDDEN = '__ordenHidden'
  if (chrome.tabs) {
    const tabs = chrome.tabs
    const hidden = async () => new Set(await session.get(HIDDEN, []))
    const dressed = (tab, gone) =>
      tab && typeof tab === 'object'
        ? { cookieStoreId: DEFAULT_STORE, hidden: gone.has(tab.id), ...tab }
        : tab
    // What only Firefox's `tabs` takes, by the call that takes it.
    const ONLY_FIREFOX = {
      create: ['cookieStoreId', 'openInReaderMode', 'discarded', 'title', 'muted'],
      update: ['loadReplace', 'successorTabId'],
      query: [
        'cookieStoreId',
        'hidden',
        'openerTabId',
        'isArticle',
        'isInReaderMode',
        'attention',
        'camera',
        'microphone',
        'screen',
      ],
    }
    const plain = (name) => (properties) => {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties))
        return properties
      const dropped = new Set(ONLY_FIREFOX[name] ?? [])
      return Object.fromEntries(Object.entries(properties).filter(([field]) => !dropped.has(field)))
    }
    wrapped(tabs, 'query', (own) =>
      promised(async (asked = {}) => {
        const { cookieStoreId, hidden: wantHidden, openerTabId } = asked
        if (cookieStoreId !== undefined && ![].concat(cookieStoreId).includes(DEFAULT_STORE))
          return []
        const gone = await hidden()
        return (await own(plain('query')(asked)))
          .map((tab) => dressed(tab, gone))
          .filter((tab) => wantHidden === undefined || tab.hidden === wantHidden)
          .filter((tab) => openerTabId === undefined || tab.openerTabId === openerTabId)
      }),
    )
    for (const name of ['get', 'getCurrent', 'create', 'duplicate', 'update', 'move']) {
      wrapped(tabs, name, (own) =>
        promised(async (...args) => {
          const answer = await own(...args.map(plain(name)))
          const gone = await hidden()
          return Array.isArray(answer)
            ? answer.map((tab) => dressed(tab, gone))
            : dressed(answer, gone)
        }),
      )
    }
    put(
      tabs,
      'hide',
      promised(async (ids) => {
        const gone = await hidden()
        const list = [].concat(ids)
        for (const id of list) gone.add(id)
        await session.set(HIDDEN, [...gone])
        return list
      }),
    )
    put(
      tabs,
      'show',
      promised(async (ids) => {
        const gone = await hidden()
        for (const id of [].concat(ids)) gone.delete(id)
        await session.set(HIDDEN, [...gone])
      }),
    )
    put(tabs, 'toggleReaderMode', refused('tabs.toggleReaderMode'))
    put(
      tabs,
      'moveInSuccession',
      promised(() => undefined),
    )
    put(
      tabs,
      'warmup',
      promised(() => undefined),
    )
    put(
      tabs,
      'captureTab',
      promised((tabId, options) => tabs.captureVisibleTab(undefined, options)),
    )
    // An event Firefox lets an add-on narrow, by address, property, tab or window.
    filtered(tabs.onUpdated, (listener, [filter]) => ({
      listener: (tabId, change, tab) => {
        if (filter?.tabId !== undefined && filter.tabId !== tabId) return
        if (filter?.windowId !== undefined && filter.windowId !== tab?.windowId) return
        if (filter?.properties && !filter.properties.some((name) => name in change)) return
        listener(tabId, change, dressed(tab, new Set()))
      },
      extra: [],
    }))
    for (const name of ['onCreated', 'onActivated', 'onRemoved'])
      filtered(tabs[name], (listener) => ({
        listener: (first, ...rest) =>
          listener(name === 'onCreated' ? dressed(first, new Set()) : first, ...rest),
        extra: [],
      }))

    // A Manifest V2 script or sheet put into a tab, through `scripting`.
    const into = async (tabId, details = {}) => {
      const id = tabId ?? (await tabs.query({ active: true, currentWindow: true }))[0]?.id
      const target = { tabId: id }
      if (details.allFrames) target.allFrames = true
      else if (details.frameId !== undefined) target.frameIds = [details.frameId]
      return target
    }
    const split = (args) =>
      typeof args[0] === 'object' && args[0] !== null ? [undefined, args[0]] : [args[0], args[1]]
    if (chrome.scripting) {
      put(
        tabs,
        'executeScript',
        promised(async (...args) => {
          const [tabId, details] = split(args)
          if (details?.code !== undefined)
            throw new Error('Running a string of code in a tab is not supported in Orden.')
          const results = await chrome.scripting.executeScript({
            target: await into(tabId, details),
            files: withOurs([details.file]),
            injectImmediately: details.runAt === 'document_start',
          })
          return results.map((one) => one.result)
        }),
      )
      for (const [name, own] of [
        ['insertCSS', 'insertCSS'],
        ['removeCSS', 'removeCSS'],
      ]) {
        put(
          tabs,
          name,
          promised(async (...args) => {
            const [tabId, details] = split(args)
            await chrome.scripting[own]({
              target: await into(tabId, details),
              ...(details.file
                ? { files: [details.file.replace(/^\//, '')] }
                : { css: details.code }),
              origin: details.cssOrigin === 'user' ? 'USER' : 'AUTHOR',
            })
          }),
        )
      }
      // A file of the add-on's own put into a tab, which reads `browser` too.
      wrapped(chrome.scripting, 'executeScript', (own) => (injection, ...rest) => {
        if (injection?.files && injection.world !== 'MAIN')
          injection = {
            ...injection,
            files: withOurs(injection.files),
          }
        return own(injection, ...rest)
      })
      wrapped(
        chrome.scripting,
        'registerContentScripts',
        (own) =>
          (scripts, ...rest) =>
            own(
              scripts.map((one) =>
                one.js && one.world !== 'MAIN' ? { ...one, js: withOurs(one.js) } : one,
              ),
              ...rest,
            ),
      )
    }

    // Firefox's find bar, from a script in the tab: the matches counted and painted with the
    // page's own highlights.
    const FOUND = 'orden-find'
    put(chrome, 'find', {
      find: promised(async (query, options = {}) => {
        const id = options.tabId ?? (await tabs.query({ active: true, currentWindow: true }))[0]?.id
        const [done] = await chrome.scripting.executeScript({
          target: { tabId: id },
          args: [String(query), !!options.caseSensitive, !!options.entireWord, FOUND],
          func: (asked, cased, whole, name) => {
            const ranges = []
            const walker = document.createTreeWalker(
              document.body ?? document.documentElement,
              NodeFilter.SHOW_TEXT,
            )
            const flags = cased ? 'g' : 'gi'
            const escaped = asked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern = new RegExp(whole ? `\\b${escaped}\\b` : escaped, flags)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              for (const match of node.data.matchAll(pattern)) {
                const range = document.createRange()
                range.setStart(node, match.index)
                range.setEnd(node, match.index + match[0].length)
                ranges.push(range)
              }
            }
            globalThis[`__${name}`] = ranges
            return { count: ranges.length }
          },
        })
        return done?.result ?? { count: 0 }
      }),
      highlightResults: promised(async (options = {}) => {
        const id = options.tabId ?? (await tabs.query({ active: true, currentWindow: true }))[0]?.id
        await chrome.scripting.executeScript({
          target: { tabId: id },
          args: [FOUND],
          func: (name) => {
            const ranges = globalThis[`__${name}`] ?? []
            if (!globalThis.CSS?.highlights) return
            CSS.highlights.set(name, new Highlight(...ranges))
            if (!document.getElementById(name)) {
              const style = document.createElement('style')
              style.id = name
              style.textContent = `::highlight(${name}) { background: #ffde4a; color: #000 }`
              document.documentElement.append(style)
            }
            ranges[0]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
          },
        })
      }),
      removeHighlighting: promised(async (tabId) => {
        const id = tabId ?? (await tabs.query({ active: true, currentWindow: true }))[0]?.id
        await chrome.scripting.executeScript({
          target: { tabId: id },
          args: [FOUND],
          func: (name) => globalThis.CSS?.highlights?.delete(name),
        })
      }),
    })
  }

  // What Firefox keeps beside a tab or a window for an add-on, kept for the session.
  if (chrome.sessions) {
    const VALUES = '__ordenSessionValues'
    const values = () => session.get(VALUES, {})
    const keyOf = (kind, id, key) => `${kind}:${id}:${key}`
    for (const kind of ['Tab', 'Window']) {
      put(
        chrome.sessions,
        `set${kind}Value`,
        promised(async (id, key, value) => {
          const all = await values()
          all[keyOf(kind, id, key)] = JSON.stringify(value)
          await session.set(VALUES, all)
        }),
      )
      put(
        chrome.sessions,
        `get${kind}Value`,
        promised(async (id, key) => {
          const held = (await values())[keyOf(kind, id, key)]
          return held === undefined ? undefined : JSON.parse(held)
        }),
      )
      put(
        chrome.sessions,
        `remove${kind}Value`,
        promised(async (id, key) => {
          const gone = keyOf(kind, id, key)
          const all = Object.entries(await values()).filter(([held]) => held !== gone)
          await session.set(VALUES, Object.fromEntries(all))
        }),
      )
    }
  }

  // Requests: watched as Firefox lets an add-on watch them. Blocking, changing and reading
  // what comes back are Firefox's alone among the engines Orden runs on; a listener that
  // asked to block still hears every request, and what it answers is not done.
  if (chrome.webRequest) {
    const EVENTS = [
      'onBeforeRequest',
      'onBeforeSendHeaders',
      'onSendHeaders',
      'onHeadersReceived',
      'onAuthRequired',
      'onResponseStarted',
      'onBeforeRedirect',
      'onCompleted',
      'onErrorOccurred',
    ]
    for (const name of EVENTS) {
      filtered(chrome.webRequest[name], (listener, [filter, spec]) => ({
        listener: (details) => void listener(details),
        extra: [
          filter ?? { urls: ['<all_urls>'] },
          ...(spec ? [spec.filter((one) => one !== 'blocking' && one !== 'asyncBlocking')] : []),
        ],
      }))
    }
    put(chrome.webRequest, 'filterResponseData', () => {
      throw new Error('webRequest.filterResponseData is not supported in Orden.')
    })
  }

  // A notification without a picture, which Chromium will not show, is shown with the
  // add-on's own.
  if (chrome.notifications) {
    wrapped(chrome.notifications, 'create', (own) => (...args) => {
      const at = typeof args[0] === 'string' || args[0] === undefined ? 1 : 0
      const options = args[at]
      if (options && !options.iconUrl)
        args[at] = { ...options, iconUrl: chrome.runtime.getURL(LAYER.icon ?? 'orden/icon.png') }
      if (args[at] && !args[at].type) args[at].type = 'basic'
      return own(...args)
    })
  }

  // Cookies in Firefox's one store by its name.
  if (chrome.cookies) {
    for (const name of ['get', 'getAll', 'set', 'remove']) {
      wrapped(chrome.cookies, name, (own) => (details, ...rest) => {
        if (details && typeof details === 'object') {
          details = { ...details }
          if (typeof details.storeId === 'string' && details.storeId.startsWith('firefox-'))
            delete details.storeId
          delete details.firstPartyDomain
        }
        return own(details, ...rest)
      })
    }
  }

  // Firefox's sidebar, which opens as a tab of its own.
  const SIDEBAR = {
    panel: LAYER.sidebar ? chrome.runtime.getURL(LAYER.sidebar) : '',
    title: LAYER.sidebarTitle ?? '',
  }
  put(chrome, 'sidebarAction', {
    setPanel: promised(
      ({ panel }) =>
        void (SIDEBAR.panel = panel ? new URL(panel, chrome.runtime.getURL('/')).href : ''),
    ),
    getPanel: promised(() => SIDEBAR.panel),
    setTitle: promised(({ title }) => void (SIDEBAR.title = title ?? '')),
    getTitle: promised(() => SIDEBAR.title),
    setIcon: promised(() => undefined),
    open: promised(() =>
      SIDEBAR.panel && chrome.tabs
        ? chrome.tabs.create({ url: SIDEBAR.panel }).then(() => undefined)
        : undefined,
    ),
    close: promised(() => undefined),
    toggle: promised(() =>
      SIDEBAR.panel && chrome.tabs
        ? chrome.tabs.create({ url: SIDEBAR.panel }).then(() => undefined)
        : undefined,
    ),
    isOpen: promised(() => false),
  })

  // The browser's own colours, which an add-on may read and in Orden may not change.
  put(chrome, 'theme', {
    getCurrent: promised(() => ({ colors: null, images: null, properties: null })),
    update: refused('theme.update'),
    reset: promised(() => undefined),
    onUpdated: event(),
  })

  put(
    chrome.commands,
    'update',
    promised(() => undefined),
  )
  put(
    chrome.commands,
    'reset',
    promised(() => undefined),
  )

  if (chrome.search && !chrome.search.search) {
    chrome.search.search = promised((properties = {}) =>
      chrome.search.query({
        text: properties.query,
        tabId: properties.tabId,
        disposition: properties.disposition,
      }),
    )
    put(
      chrome.search,
      'get',
      promised(() => []),
    )
  }

  put(chrome, 'dns', { resolve: refused('dns.resolve') })
  put(chrome, 'pkcs11', {
    isModuleInstalled: promised(() => false),
    installModule: refused('pkcs11.installModule'),
    uninstallModule: refused('pkcs11.uninstallModule'),
    getModuleSlots: refused('pkcs11.getModuleSlots'),
  })
  put(
    chrome,
    'browserSettings',
    new Proxy(
      {},
      {
        get: (target, name) =>
          typeof name !== 'string'
            ? undefined
            : (target[name] ??= {
                get: promised(() => ({ value: undefined, levelOfControl: 'not_controllable' })),
                set: promised(() => false),
                clear: promised(() => false),
                onChange: event(),
              }),
      },
    ),
  )
  put(chrome, 'captivePortal', {
    getState: promised(() => 'unknown'),
    getLastChecked: promised(() => -1),
    onStateChanged: event(),
    onConnectivityAvailable: event(),
  })
  if (chrome.proxy) put(chrome.proxy, 'onRequest', event())
})()
