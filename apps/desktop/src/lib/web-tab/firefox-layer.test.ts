/** The Firefox layer a Firefox add-on runs through (#1155; src-tauri/src/extensions/firefox.rs),
 *  in each of its contexts, against an engine of the test's own: a page of the add-on's, a
 *  content script, the background page as the offscreen document it runs as, and the
 *  service worker that makes its calls. In each, `browser` is there with promises, made by
 *  the WebExtension polyfill of `chrome` as the layer leaves it, and what Firefox alone has
 *  answers as the layer emulates it. */

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return --
   the extension API is called here as an add-on calls it: untyped, whatever the engine is. */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

const read = (name: string) =>
  readFileSync(
    new URL(`../../../src-tauri/src/extensions/firefox/${name}`, import.meta.url),
    'utf8',
  )
const FIREFOX = read('firefox.js')
const POLYFILL = read('browser-polyfill.js')
const BRIDGE = read('bridge.js')
const HOST = read('host.js')

const LAYER = {
  firefox: '140.0',
  manifest: { manifest_version: 2, name: 'Test', browser_action: { default_title: 'Test' } },
  sidebar: 'sidebar.html',
  background: 'orden/background.html',
}
const TOLD = `globalThis.__ordenLayer = ${JSON.stringify(LAYER)};\n`

type Listener = (...args: any[]) => unknown

function event() {
  const listeners = new Set<Listener>()
  return {
    listeners,
    addListener: (one: Listener) => void listeners.add(one),
    removeListener: (one: Listener) => void listeners.delete(one),
    hasListener: (one: Listener) => listeners.has(one),
    fire: (...args: unknown[]) => [...listeners].map((one) => one(...args)),
  }
}

/** A call the engine answers as Chromium's do: a promise, or the callback it is handed. */
function api<T>(work: (...args: any[]) => T | Promise<T>) {
  return (...args: any[]) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null
    const answered = Promise.resolve(work(...args))
    if (callback) void answered.then(callback)
    return answered
  }
}

/** The engine's API as an extension page and a service worker have it. */
function engine() {
  const held = { local: new Map<string, unknown>(), session: new Map<string, unknown>() }
  const changed = event()
  const area = (name: 'local' | 'session') => ({
    get: api((key: string) => ({ [key]: held[name].get(key) })),
    set: api((items: Record<string, unknown>) => {
      const changes: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: held[name].get(key), newValue: value }
        held[name].set(key, value)
      }
      changed.fire(changes, name)
    }),
  })
  const created: unknown[] = []
  const executed: unknown[] = []
  return {
    created,
    executed,
    chrome: {
      runtime: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        lastError: undefined,
        getURL: (path: string) =>
          `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path.replace(/^\//, '')}`,
        getManifest: () => ({ manifest_version: 3 }),
        onMessage: event(),
        onInstalled: event(),
        onStartup: event(),
        onConnect: event(),
        sendMessage: api(() => undefined),
      },
      tabs: {
        query: api(() => [
          { id: 1, windowId: 1, openerTabId: 9 },
          { id: 2, windowId: 1 },
        ]),
        get: api((id: number) => ({ id, windowId: 1 })),
        create: api((properties: Record<string, unknown>) => {
          created.push(properties)
          return { id: 3, windowId: 1 }
        }),
        update: api((id: number) => ({ id, windowId: 1 })),
        onUpdated: event(),
        onCreated: event(),
        onActivated: event(),
        onRemoved: event(),
      },
      scripting: {
        executeScript: api((injection: unknown) => {
          executed.push(injection)
          return [{ result: 'done' }]
        }),
      },
      action: { setTitle: api(() => undefined), enable: api(() => undefined) },
      contextMenus: {
        create: (properties: Record<string, unknown>) => {
          created.push(properties)
          return properties.id
        },
        update: api(() => undefined),
        onClicked: event(),
      },
      permissions: { contains: api(() => true), request: api(() => true), remove: api(() => true) },
      storage: { local: area('local'), session: area('session'), onChanged: changed },
      i18n: { getMessage: (name: string) => `[${name}]` },
    },
  }
}

/** A page of the add-on's own, as the layer and the polyfill leave it. */
function page() {
  const made = engine()
  const dom = new JSDOM('<p>popup</p>', {
    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    runScripts: 'outside-only',
  })
  const inside = dom.window as unknown as Record<string, any> & { eval: (code: string) => unknown }
  inside.chrome = made.chrome
  // Chromium's own `browser`, which is `chrome` without the layer.
  inside.browser = { runtime: { id: made.chrome.runtime.id } }
  inside.eval(TOLD + FIREFOX)
  inside.eval(POLYFILL)
  return { ...made, browser: inside.browser, window: inside }
}

describe('a page of the add-on', () => {
  test('has `browser` made of the layer, with promises', async () => {
    const { browser } = page()
    expect(await browser.runtime.getBrowserInfo()).toMatchObject({
      name: 'Firefox',
      version: '140.0',
    })
    expect(browser.runtime.getManifest()).toEqual(LAYER.manifest)
    expect(typeof browser.browserAction.setTitle).toBe('function')
    expect(await browser.tabs.query({})).toEqual([
      { id: 1, windowId: 1, openerTabId: 9, cookieStoreId: 'firefox-default', hidden: false },
      { id: 2, windowId: 1, cookieStoreId: 'firefox-default', hidden: false },
    ])
  })

  test('has containers of its own, and tabs only in the one store', async () => {
    const { browser } = page()
    const all = await browser.contextualIdentities.query({})
    expect(all.map((one: { name: string }) => one.name)).toEqual([
      'Personal',
      'Work',
      'Banking',
      'Shopping',
    ])
    const created: unknown[] = []
    browser.contextualIdentities.onCreated.addListener((said: unknown) => created.push(said))
    const made = await browser.contextualIdentities.create({
      name: 'Travel',
      color: 'red',
      icon: 'tree',
    })
    expect(made).toMatchObject({ cookieStoreId: 'firefox-container-5', colorCode: '#ff613d' })
    expect(created).toHaveLength(1)
    expect(await browser.tabs.query({ cookieStoreId: 'firefox-container-1' })).toEqual([])
    expect(await browser.tabs.query({ openerTabId: 9 })).toHaveLength(1)
  })

  test('hides tabs for itself, and keeps what Firefox keeps beside a tab', async () => {
    const { browser } = page()
    expect(await browser.tabs.hide([2])).toEqual([2])
    expect(
      (await browser.tabs.query({ hidden: true })).map((tab: { id: number }) => tab.id),
    ).toEqual([2])
    await browser.tabs.show(2)
    expect(await browser.tabs.query({ hidden: true })).toEqual([])
  })

  test('makes a menu Chromium takes, and says a Firefox-only permission is not held', async () => {
    const { browser, created } = page()
    browser.menus.create({ id: 'a', contexts: ['tab', 'browser_action'], icons: { 16: 'a.svg' } })
    browser.menus.create({
      id: 'b',
      contexts: ['tab'],
      documentUrlPatterns: ['moz-extension://x/*'],
    })
    expect(created).toEqual([
      { id: 'a', contexts: ['action'], title: 'a' },
      {
        id: 'b',
        contexts: ['page'],
        visible: false,
        title: 'b',
        documentUrlPatterns: ['chrome-extension://x/*'],
      },
    ])
    expect(await browser.permissions.contains({ permissions: ['tabHide'] })).toBe(false)
    expect(await browser.permissions.contains({ permissions: ['tabs'] })).toBe(true)
  })

  test('opens its sidebar as a tab, and puts a Manifest V2 script in a tab with `browser`', async () => {
    const { browser, created, executed } = page()
    await browser.sidebarAction.open()
    expect(created).toEqual([
      { url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidebar.html' },
    ])
    expect(await browser.tabs.executeScript(1, { file: '/content.js' })).toEqual(['done'])
    expect(executed[0]).toMatchObject({
      target: { tabId: 1 },
      files: ['orden/firefox.js', 'orden/browser-polyfill.js', 'content.js'],
    })
    await expect(browser.tabs.executeScript(1, { code: '1' })).rejects.toThrow('not supported')
    await expect(browser.dns.resolve('example.com')).rejects.toThrow('not supported')
  })

  test('reads a message by the name Firefox takes', () => {
    const { browser } = page()
    expect(browser.i18n.getMessage('onboarding-1-header')).toBe('[onboarding_1_header]')
  })
})

describe('a content script', () => {
  test('has `browser`, and the element a menu was opened on', () => {
    const made = engine()
    const dom = new JSDOM('<p id="here">words</p>', {
      url: 'https://example.com/',
      runScripts: 'outside-only',
    })
    const inside = dom.window as unknown as Record<string, any> & {
      eval: (code: string) => unknown
    }
    // A content script has the engine's messaging, storage and words, and no tabs or menus.
    const { runtime, storage, i18n, permissions } = made.chrome
    inside.chrome = { runtime, storage, i18n, permissions }
    inside.eval(TOLD + FIREFOX)
    inside.eval(POLYFILL)
    expect(typeof inside.browser.runtime.sendMessage).toBe('function')
    const here = inside.document.getElementById('here')
    here.dispatchEvent(new inside.MouseEvent('contextmenu', { bubbles: true }))
    expect(inside.browser.menus.getTargetElement(1)).toBe(here)
  })
})

/** A port as the engine's messaging hands one, both ends. */
function ports() {
  const one = { onMessage: event(), onDisconnect: event(), sent: [] as any[] }
  const two = { onMessage: event(), onDisconnect: event(), sent: [] as any[] }
  const end = (self: typeof one, other: typeof one, name: string) => ({
    name,
    sender: { id: 'abcdefghijklmnopabcdefghijklmnop' },
    onMessage: self.onMessage,
    onDisconnect: self.onDisconnect,
    postMessage: (message: unknown) => {
      self.sent.push(message)
      queueMicrotask(() => other.onMessage.fire(JSON.parse(JSON.stringify(message))))
    },
  })
  return { page: end(one, two, '__orden'), worker: end(two, one, '__orden') }
}

describe('the background page and the service worker it calls through', () => {
  function both() {
    const made = engine()
    const { page: pageEnd, worker: workerEnd } = ports()

    // The service worker, with the layer over the engine's own API.
    const worker: Record<string, any> = {
      chrome: made.chrome,
      console,
      queueMicrotask,
      setTimeout,
      URL,
      // Every global this test makes is the worker's own.
      ServiceWorkerGlobalScope: Object.defineProperty(() => undefined, Symbol.hasInstance, {
        value: () => true,
      }),
    }
    worker.globalThis = worker
    vm.createContext(worker)
    worker.importScripts = (path: string) => {
      if (path === '/orden/firefox.js') vm.runInContext(TOLD + FIREFOX, worker)
    }
    // No offscreen documents in this engine's worker, so nothing is opened.
    vm.runInContext(HOST.replace('LAYER.background && chrome.offscreen', 'false'), worker)
    made.chrome.runtime.onConnect.fire(workerEnd)

    // The offscreen document: the engine's messaging and nothing else.
    const dom = new JSDOM('', {
      url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/orden/background.html',
      runScripts: 'outside-only',
    })
    const inside = dom.window as unknown as Record<string, any> & {
      eval: (code: string) => unknown
    }
    const files: Record<string, string> = {
      '/manifest.json': JSON.stringify({ manifest_version: 3, default_locale: 'en' }),
      '/_locales/en/messages.json': JSON.stringify({
        greeting: { message: 'Hello $who$', placeholders: { who: { content: '$1' } } },
      }),
    }
    inside.XMLHttpRequest = class {
      path = ''
      status = 0
      responseText = ''
      open(_: string, path: string) {
        this.path = path
      }
      send() {
        this.status = this.path in files ? 200 : 404
        this.responseText = files[this.path] ?? ''
      }
    }
    inside.chrome = {
      runtime: {
        id: made.chrome.runtime.id,
        connect: () => pageEnd,
        onMessage: event(),
        sendMessage: api(() => undefined),
      },
    }
    inside.browser = { runtime: { id: made.chrome.runtime.id } }
    inside.eval(BRIDGE)
    inside.eval(TOLD + FIREFOX)
    inside.eval(POLYFILL)
    return { ...made, engine: made.chrome, browser: inside.browser, chrome: inside.chrome, worker }
  }

  test('makes every call in the service worker, with the layer there', async () => {
    const { browser } = both()
    expect(await browser.tabs.query({})).toHaveLength(2)
    expect(await browser.runtime.getBrowserInfo()).toMatchObject({ name: 'Firefox' })
    expect((await browser.contextualIdentities.query({})).length).toBe(4)
    expect(browser.runtime.getManifest()).toEqual(LAYER.manifest)
    expect(await browser.runtime.getBackgroundPage()).toBeTruthy()
  })

  test('answers a refusal as a rejection, and a callback with `lastError`', async () => {
    const { browser, chrome } = both()
    await expect(browser.dns.resolve('example.com')).rejects.toThrow('not supported')
    const said = await new Promise<string | undefined>((done) =>
      chrome.dns.resolve('example.com', () => done(chrome.runtime.lastError?.message)),
    )
    expect(said).toContain('not supported')
  })

  test('hears an event the service worker hears, and its install', async () => {
    const { browser, engine: own } = both()
    own.runtime.onInstalled.fire({ reason: 'install' })
    const heard: unknown[] = []
    browser.tabs.onCreated.addListener((tab: unknown) => heard.push(tab))
    browser.runtime.onInstalled.addListener((details: unknown) => heard.push(details))
    await new Promise((done) => setTimeout(done, 10))
    own.tabs.onCreated.fire({ id: 5, windowId: 1 })
    await new Promise((done) => setTimeout(done, 10))
    expect(heard).toEqual([
      { reason: 'install' },
      { id: 5, windowId: 1, cookieStoreId: 'firefox-default', hidden: false },
    ])
  })

  test('has a menu item’s id at once, and runs what pressing it runs', async () => {
    const { chrome, created } = both()
    const id = chrome.contextMenus.create({ title: 'Do', onclick: () => undefined })
    expect(id).toBe('orden-menu-1')
    await new Promise((done) => setTimeout(done, 10))
    expect(created).toEqual([{ title: 'Do', id: 'orden-menu-1' }])
  })

  test('reads its own words at once', () => {
    const { browser } = both()
    expect(browser.i18n.getMessage('greeting', 'you')).toBe('Hello you')
  })
})
