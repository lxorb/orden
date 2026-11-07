const ROUTE = '/asset/'
const DATABASE = 'orden'
const FORMER_DATABASE = 'nib'
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
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  if (!isOurs(event.request)) return
  event.respondWith(answer(event.request))
})

function isOurs(request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  return url.origin === self.location.origin && url.pathname.startsWith(ROUTE)
}

async function answer(request) {
  const path = pathOf(new URL(request.url).pathname)
  if (!path) return missing()

  const row = await rowFor(path).catch(() => null)
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

async function rowFor(path) {
  const row = await rowIn(DATABASE, path).catch(() => null)
  return row || rowIn(FORMER_DATABASE, path)
}

self.addEventListener('notificationclick', (event) => {
  const tag = event.notification.data?.nibNotice
  event.notification.close()
  event.waitUntil(cameBackTo(tag))
})

async function cameBackTo(tag) {
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = open[0] ?? (await self.clients.openWindow('/'))
  if (!client) return

  await client.focus?.().catch(() => undefined)
  if (typeof tag === 'string') client.postMessage({ nibNotice: tag })
}
