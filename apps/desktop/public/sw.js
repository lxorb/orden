const ROUTE = '/asset/'
const DATABASE = 'nib'
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

  return new Response(bytes, {
    headers: {
      'Content-Type': typeOf(path, row.type),
      'Content-Length': String(bytes.length),
      'Cache-Control': HASHED.test(nameOf(path)) ? FOREVER : EVERY_TIME,
    },
  })
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

let opening = null

function database() {
  if (opening) return opening

  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE)

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      db.onclose = () => {
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => {
      opening = null
      reject(request.error || new Error('the store would not open'))
    }
    request.onblocked = () => {
      opening = null
      reject(new Error('the store is busy'))
    }
  })

  return opening
}

async function rowFor(path) {
  const db = await database()
  if (!db.objectStoreNames.contains(STORE)) return null

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(path)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('the row would not be read'))
  })
}
