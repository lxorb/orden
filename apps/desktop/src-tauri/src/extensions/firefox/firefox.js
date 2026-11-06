;(function () {
  if (globalThis.__ordenFirefox) return
  globalThis.__ordenFirefox = true
  const chrome = globalThis.chrome
  if (!chrome?.runtime?.id) return

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
  const withOurs = (files) => [
    ...new Set([...OURS, ...files.map((one) => String(one).replace(/^\//, ''))]),
  ]
  const fileOf = (file) =>
    page
      ? decodeURIComponent(new URL(String(file), globalThis.location.href).pathname).slice(1)
      : String(file).replace(/^\//, '')

  const matching = (patterns, url) => {
    let address
    try {
      address = new URL(url)
    } catch {
      return false
    }
    return [].concat(patterns).some((pattern) => {
      if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file|data):$/.test(address.protocol)
      const parts = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/.exec(String(pattern))
      if (!parts) return false
      const [, scheme, host, path] = parts
      const schemes = scheme === '*' ? ['http:', 'https:', 'ws:', 'wss:'] : [`${scheme}:`]
      if (!schemes.includes(address.protocol)) return false
      const own = host.includes(':') ? address.host : address.hostname
      const name = host.startsWith('*.') ? host.slice(2) : host
      if (host !== '*' && own !== name && !(host.startsWith('*.') && own.endsWith(`.${name}`)))
        return false
      const glob = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      return new RegExp(`^${glob}$`).test(address.pathname + address.search)
    })
  }

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

  function wrapped(on, name, wrap) {
    const own = on?.[name]
    if (typeof own === 'function') on[name] = wrap(own.bind(on))
  }

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

  const plainName = (name) => String(name).replace(/[^A-Za-z0-9_@]/g, '_')
  if (chrome.i18n?.getMessage && !background) {
    const own = chrome.i18n.getMessage.bind(chrome.i18n)
    chrome.i18n.getMessage = (name, ...rest) => own(plainName(name), ...rest)
  }

  const worded = (value) => {
    if (typeof value === 'string')
      return value.replace(
        /__MSG_([A-Za-z0-9_@]+)__/g,
        (said, name) => chrome.i18n?.getMessage?.(name) || said,
      )
    if (Array.isArray(value)) return value.map(worded)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, worded(one)]))
    return value
  }
  if (LAYER.manifest) chrome.runtime.getManifest = () => worded(LAYER.manifest)

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

  if (chrome.extension) put(chrome.extension, 'getURL', (path) => chrome.runtime.getURL(path))
  else chrome.extension = { getURL: (path) => chrome.runtime.getURL(path) }

  if (page) {
    const backgroundPage = () =>
      chrome.extension.getViews?.().find((view) => view.__ordenBackground === true) ?? null
    chrome.extension.getBackgroundPage = backgroundPage
    chrome.runtime.getBackgroundPage = promised(backgroundPage)
  }

  if (content) {
    let target = null
    document.addEventListener('contextmenu', (event) => (target = event.target), true)
    chrome.menus = { getTargetElement: () => target }
    return
  }

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
        id,
        unregister: promised(() => chrome.scripting.unregisterContentScripts({ ids: [id] })),
      }
    }),
  })

  if (!full) return

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
        if (!out.contexts.length) out.visible = false
        if (!out.contexts.length) out.contexts = ['page']
      }
      for (const field of ['documentUrlPatterns', 'targetUrlPatterns']) {
        if (Array.isArray(out[field])) out[field] = out[field].map(ours)
      }
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

  const HIDDEN = '__ordenHidden'
  if (chrome.tabs) {
    const tabs = chrome.tabs
    const hidden = async () => new Set(await session.get(HIDDEN, []))
    const dressed = (tab, gone) =>
      tab && typeof tab === 'object'
        ? { cookieStoreId: DEFAULT_STORE, hidden: gone.has(tab.id), ...tab }
        : tab
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
    filtered(tabs.onUpdated, (listener, [filter]) => ({
      listener: (tabId, change, tab) => {
        if (filter?.tabId !== undefined && filter.tabId !== tabId) return
        if (filter?.windowId !== undefined && filter.windowId !== tab?.windowId) return
        if (filter?.properties && !filter.properties.some((name) => name in change)) return
        if (filter?.urls && !matching(filter.urls, tab?.url)) return
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
            files: withOurs([fileOf(details.file)]),
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
              ...(details.file ? { files: [fileOf(details.file)] } : { css: details.code }),
              origin: details.cssOrigin === 'user' ? 'USER' : 'AUTHOR',
            })
          }),
        )
      }
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
    const KINDS = {
      beacon: 'ping',
      imageset: 'image',
      object_subrequest: 'object',
      xml_dtd: 'other',
      xslt: 'other',
      web_manifest: 'other',
      speculative: 'other',
      json: 'other',
    }
    const kinds = (filter) =>
      Array.isArray(filter?.types)
        ? { ...filter, types: [...new Set(filter.types.map((one) => KINDS[one] ?? one))] }
        : filter
    for (const name of EVENTS) {
      filtered(chrome.webRequest[name], (listener, [filter, spec]) => ({
        listener: (details) => void listener(details),
        extra: [
          kinds(filter) ?? { urls: ['<all_urls>'] },
          ...(spec ? [spec.filter((one) => one !== 'blocking' && one !== 'asyncBlocking')] : []),
        ],
      }))
    }
    put(chrome.webRequest, 'filterResponseData', () => {
      throw new Error('webRequest.filterResponseData is not supported in Orden.')
    })
  }

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
