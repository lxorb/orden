import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const from = process.argv[2] ?? join('apps', 'desktop', 'dist-even')
const to = process.argv[3] ?? from

const plugin = join(from, 'even.html')
let page
try {
  page = readFileSync(plugin, 'utf8')
} catch {
  console.error(`no ${plugin}: run the build first`)
  process.exit(1)
}

if (to !== from) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
}

writeFileSync(join(to, 'index.html'), page)
writeFileSync(join(to, 'even.html'), page)

for (const stray of ['manifest.webmanifest', 'sw.js', 'registerSW.js']) {
  rmSync(join(to, stray), { force: true })
}

const MANIFEST = JSON.parse(
  readFileSync(new URL('../apps/desktop/even.app.json', import.meta.url), 'utf8'),
)
const ALLOWED = MANIFEST.permissions.find((one) => one.name === 'network')?.whitelist ?? []

const NAMESPACES = /^https?:\/\/www\.w3\.org\//

function namespaced(url, file) {
  if (file.endsWith('.css')) return url.replace('://', '%3A//')

  if (file.endsWith('.html') || file.endsWith('.webmanifest')) {
    return url.replace('://', '&#58;//')
  }

  return url.replace('://', ':\\/\\/')
}

function plain(url, file) {
  if (ALLOWED.some((one) => url.startsWith(one))) return url
  if (NAMESPACES.test(url)) return namespaced(url, file)

  const svelte = /^https:\/\/svelte\.dev\/e\/([\w-]+)$/.exec(url)
  if (svelte) return svelte[1]

  return url.replace(/^https?:\/\//, '')
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }

  return out
}

const URLS = /https?:\/\/[^\s"'`)\\<>]*/g
let rewritten = 0

for (const file of walk(to)) {
  if (!/\.(js|css|html|json|webmanifest)$/.test(file)) continue

  const text = readFileSync(file, 'utf8')
  const made = text.replace(URLS, (url) => {
    const now = plain(url, file)
    if (now !== url) rewritten++
    return now
  })

  if (made !== text) writeFileSync(file, made)
}

console.log(`${to}: index.html and even.html are both the plugin, ${rewritten} URLs made plain`)
