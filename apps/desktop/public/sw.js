const ROUTE = '/asset/'
const DATABASE = 'orden'
const STORE = 'assets'

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

const UNKNOWN_TYPE = 'application/octet-stream'

const ALONE =
  "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self'; style-src 'unsafe-inline'; font-src 'self' data:"

const HASHED = /^[0-9a-f]{16,}\.[a-z0-9]+$/i
const FOREVER = 'public, max-age=31536000, immutable'
const EVERY_TIME = 'no-cache'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(Promise.all([self.clients.claim(), keepFirstPage()])),
)

const BUILT = '/assets/'
const CODE = 'orden-code-'
const PAGES = 'orden-pages'
const BUILDS = '/.orden-builds'
const KEPT_BUILDS = 3

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (isOurs(request)) event.respondWith(answer(request))
  else if (isBuilt(request)) event.respondWith(built(request, event))
  else if (isPage(request)) event.respondWith(page(request, event))
})

function sameOrigin(request) {
  return request.method === 'GET' && new URL(request.url).origin === self.location.origin
}

function isBuilt(request) {
  return sameOrigin(request) && new URL(request.url).pathname.startsWith(BUILT)
}

function isPage(request) {
  return request.mode === 'navigate' && sameOrigin(request)
}

async function built(request, event) {
  const kept = await keptCode(request)
  if (kept) return kept

  const fresh = await fetch(request)
  if (fresh.status === 200) event.waitUntil(keepCode(request, fresh.clone()))
  return fresh
}

async function keptCode(request) {
  if (typeof caches === 'undefined') return undefined
  return caches.match(request, { ignoreSearch: true, ignoreVary: true }).catch(() => undefined)
}

async function keepCode(request, response) {
  try {
    const [build] = await builds()
    const cache = await caches.open(`${CODE}${build ?? 'first'}`)
    await cache.put(withoutSearch(request), response)
  } catch {
    return undefined
  }
}

async function page(request, event) {
  try {
    const fresh = await fetch(request)
    if (fresh.status === 200 && isHtml(fresh)) event.waitUntil(keepPage(request, fresh.clone()))
    return fresh
  } catch (error) {
    const kept = await keptPage(request)
    if (kept) return kept
    throw error
  }
}

function isHtml(response) {
  return (response.headers.get('Content-Type') ?? '').includes('text/html')
}

async function keptPage(request) {
  if (typeof caches === 'undefined') return undefined
  try {
    const pages = await caches.open(PAGES)
    const asked = { ignoreSearch: true, ignoreVary: true }
    return (await pages.match(withoutSearch(request), asked)) ?? (await pages.match('/', asked))
  } catch {
    return undefined
  }
}

async function keepPage(request, response) {
  try {
    const text = await response.clone().text()
    const build = await buildOf(text)
    const pages = await caches.open(PAGES)
    await pages.put(withoutSearch(request), response)

    const before = await builds()
    const after = [build, ...before.filter((one) => one !== build)].slice(0, KEPT_BUILDS)
    for (const one of before) if (!after.includes(one)) await caches.delete(`${CODE}${one}`)
    if (before[0] === undefined) await carryFirst(build)
    await pages.put(BUILDS, new Response(JSON.stringify(after)))
    await keepNamedIn(text, new URL(request.url).origin)
  } catch {
    return undefined
  }
}

self.addEventListener('message', (event) => {
  const asked = event.data?.ordenKeep
  if (!Array.isArray(asked)) return
  const paths = asked.filter((one) => typeof one === 'string' && /^\/assets\/[^?#]+$/.test(one))
  event.waitUntil(keepNamed(paths, self.location.origin))
})

async function keepNamedIn(text, origin) {
  const named = []
  for (const found of text.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) named.push(found[1])
  await keepNamed(named, origin)
}

async function keepNamed(paths, origin) {
  if (typeof caches === 'undefined') return
  for (const path of new Set(paths)) {
    const request = new Request(`${origin}${path}`)
    if (await keptCode(request)) continue
    const fresh = await fetch(request).catch(() => null)
    if (fresh?.status === 200) await keepCode(request, fresh)
  }
}

async function keepFirstPage() {
  if (typeof caches === 'undefined') return
  const request = new Request(new URL('/', self.location.origin).href, { credentials: 'include' })
  const fresh = await fetch(request).catch(() => null)
  if (fresh?.status === 200 && isHtml(fresh)) await keepPage(request, fresh)
}

async function carryFirst(build) {
  const first = `${CODE}first`
  if (!(await caches.has(first))) return
  const from = await caches.open(first)
  const into = await caches.open(`${CODE}${build}`)
  for (const key of await from.keys()) {
    const kept = await from.match(key)
    if (kept) await into.put(key, kept)
  }
  await caches.delete(first)
}

async function builds() {
  const pages = await caches.open(PAGES)
  const said = await pages.match(BUILDS)
  if (!said) return []
  try {
    const list = JSON.parse(await said.text())
    return Array.isArray(list) ? list.filter((one) => typeof one === 'string') : []
  } catch {
    return []
  }
}

async function buildOf(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function withoutSearch(request) {
  const url = new URL(request.url)
  return `${url.origin}${url.pathname}`
}

function isOurs(request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  return url.origin === self.location.origin && url.pathname.startsWith(ROUTE)
}

async function answer(request) {
  const path = pathOf(new URL(request.url).pathname)
  if (!path) return missing()

  const row = await rowIn(DATABASE, path).catch(() => null)
  if (!row || typeof row.data !== 'string') return missing()

  const bytes = decode(row.data)
  if (!bytes) return missing()

  const type = typeOf(path, row.type)
  const headers = {
    'Content-Type': type,
    'Cache-Control': HASHED.test(nameOf(path)) ? FOREVER : EVERY_TIME,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...(type === 'application/pdf' ? {} : { 'Content-Security-Policy': ALONE }),
  }
  const asked = request.headers.get('Range')
  const span = asked === null ? undefined : spanOf(asked, bytes.length)

  if (span === undefined) {
    return new Response(bytes, {
      headers: { ...headers, 'Content-Length': String(bytes.length) },
    })
  }

  if (span === null) {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` },
    })
  }

  const [start, end] = span
  const part = bytes.subarray(start, end + 1)
  return new Response(part, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
      'Content-Length': String(part.length),
    },
  })
}

function spanOf(asked, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(asked.trim())
  if (!match || (match[1] === '' && match[2] === '')) return undefined

  if (match[1] === '') {
    const last = Number(match[2])
    if (last === 0 || size === 0) return null
    return [Math.max(0, size - last), size - 1]
  }

  const start = Number(match[1])
  if (match[2] !== '' && Number(match[2]) < start) return undefined
  if (start >= size) return null

  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return [start, end]
}

function missing() {
  return new Response(null, {
    status: 404,
    statusText: 'no such file in the space',
    headers: { 'Cache-Control': 'no-store' },
  })
}

function pathOf(pathname) {
  const written = pathname.slice(ROUTE.length)
  if (!written) return null

  try {
    return `/${written.split('/').map(decodeURIComponent).join('/')}`
  } catch {
    return null
  }
}

function nameOf(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function typeOf(path, stored) {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)
  const known = extension && TYPES[extension[1].toLowerCase()]
  return known || stored || UNKNOWN_TYPE
}

function decode(base64) {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
    return bytes
  } catch {
    return null
  }
}

const opening = new Map()

function database(name) {
  const held = opening.get(name)
  if (held) return held

  const asked = new Promise((resolve, reject) => {
    const request = indexedDB.open(name)

    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        opening.delete(name)
      }
      db.onclose = () => {
        opening.delete(name)
      }
      resolve(db)
    }
    request.onerror = () => {
      opening.delete(name)
      reject(request.error || new Error('the store would not open'))
    }
    request.onblocked = () => {
      opening.delete(name)
      reject(new Error('the store is busy'))
    }
  })

  opening.set(name, asked)
  return asked
}

async function rowIn(name, path) {
  const db = await database(name)
  if (!db.objectStoreNames.contains(STORE)) return null

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(path)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('the row would not be read'))
  })
}

self.addEventListener('notificationclick', (event) => {
  const said = event.notification.data
  const tag = said?.ordenNotice
  event.notification.close()
  event.waitUntil(cameBackTo(tag))
})

const ANSWERED_WITHIN = 300

async function cameBackTo(tag) {
  const every = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = every.filter(isTheApp)
  const holder = typeof tag === 'string' ? await holderOf(open, tag) : null
  const client = holder ?? open[0] ?? (await self.clients.openWindow('/'))
  if (!client) return

  await client.focus?.().catch(() => undefined)
  if (typeof tag === 'string') client.postMessage({ ordenNotice: tag })
}

function isTheApp(client) {
  try {
    return !new URL(client.url).pathname.startsWith(ROUTE)
  } catch {
    return true
  }
}

function holderOf(open, tag) {
  if (!open.length) return Promise.resolve(null)

  return new Promise((resolve) => {
    const lines = []
    let waiting = open.length
    const answer = (client) => {
      clearTimeout(timer)
      for (const line of lines) line.port1.close()
      resolve(client)
    }
    const timer = setTimeout(() => answer(null), ANSWERED_WITHIN)

    for (const client of open) {
      const line = new MessageChannel()
      lines.push(line)
      line.port1.onmessage = (event) => {
        waiting -= 1
        if (event.data === true) answer(client)
        else if (waiting === 0) answer(null)
      }
      client.postMessage({ ordenHolds: tag }, [line.port2])
    }
  })
}
