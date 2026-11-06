// The service worker a Firefox add-on is given in place of its background page; see
// firefox.rs. Chromium runs no background page any more, and a Firefox add-on's is a page,
// with a document and `localStorage`, that a worker has neither of. So the page runs as an
// offscreen document, which has its document and nothing of the extension's API but
// messaging, and every other call it makes comes here over a port (bridge.js) and is made
// on the real API, with the Firefox layer's emulations on it (firefox.js). An event the
// page listens to is listened to here and sent on. Where the engine has no offscreen
// documents, the page's scripts run in this worker instead, which serves a page that
// never touches its document.

importScripts('/orden/firefox.js')

const LAYER = globalThis.__ordenLayer
const PORT = '__orden'

// What the engine said before the page was there to hear it: its install and its start,
// each handed once to the first page that listens.
const early = []
const firstHeard = (path) => (details) => early.push({ path, details })
chrome.runtime.onInstalled.addListener(firstHeard('runtime.onInstalled'))
chrome.runtime.onStartup.addListener(firstHeard('runtime.onStartup'))

/** The thing a dotted path names on the API, with what it hangs from. */
function resolve(path) {
  let owner = null
  let at = chrome
  for (const part of path) {
    owner = at
    at = at?.[part]
  }
  return { owner, at }
}

/** Something the API answered, as messaging carries it. */
function said(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT || port.sender?.id !== chrome.runtime.id) return
  const heard = new Map()

  port.onMessage.addListener(async (asked) => {
    if (asked.kind === 'call') {
      const { owner, at } = resolve(asked.path)
      try {
        if (typeof at !== 'function') throw new Error(`${asked.path.join('.')} is not a function`)
        const value = await at.apply(owner, asked.args)
        port.postMessage({ kind: 'answer', id: asked.id, value: said(value) })
      } catch (error) {
        port.postMessage({ kind: 'answer', id: asked.id, error: String(error?.message ?? error) })
      }
      return
    }
    if (asked.kind === 'listen') {
      const { at } = resolve(asked.path)
      const key = asked.key
      if (!at?.addListener || heard.has(key)) return
      const send = (...args) => {
        try {
          port.postMessage({ kind: 'event', key, args: said(args) })
        } catch {
          // The page has gone; its port says so and every listener with it.
        }
      }
      try {
        at.addListener(send, ...(asked.extra ?? []))
        heard.set(key, { at, send })
      } catch (error) {
        port.postMessage({ kind: 'refused', key, error: String(error?.message ?? error) })
      }
      const name = asked.path.join('.')
      for (const one of early.filter((event) => event.path === name)) {
        early.splice(early.indexOf(one), 1)
        send(one.details)
      }
      return
    }
    if (asked.kind === 'unlisten') {
      const one = heard.get(asked.key)
      if (one) one.at.removeListener(one.send)
      heard.delete(asked.key)
    }
  })

  port.onDisconnect.addListener(() => {
    for (const one of heard.values()) one.at.removeListener(one.send)
    heard.clear()
  })
})

let opening = null

/** The page, made if it is not there. */
function page() {
  opening ??= (async () => {
    const url = chrome.runtime.getURL(LAYER.background)
    const open = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      : []
    if (open.some((one) => one.documentUrl?.split('#')[0] === url)) return
    await chrome.offscreen.createDocument({
      url,
      reasons: ['LOCAL_STORAGE', 'DOM_PARSER', 'BLOBS', 'WORKERS'],
      justification: 'The add-on’s background page.',
    })
  })().finally(() => {
    opening = null
  })
  return opening
}

if (LAYER.background && chrome.offscreen) {
  void page().catch((error) => console.error('The background page did not open:', error))
  chrome.runtime.onStartup.addListener(() => void page().catch(() => undefined))
} else if (LAYER.scripts?.length) {
  globalThis.window = globalThis
  importScripts('/orden/browser-polyfill.js', ...LAYER.scripts.map((one) => `/${one}`))
}
