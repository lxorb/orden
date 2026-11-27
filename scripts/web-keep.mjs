import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const DAY = 86_400_000
const MOST = 8000
const AT_ONCE = 16
const NAME = /^[\w@+~-][\w@+~.-]*(?:\/[\w@+~-][\w@+~.-]*)*$/
const [dist, origin, days = '7', salt = ''] = process.argv.slice(2)
if (!dist || !origin) {
  console.error('usage: node scripts/web-keep.mjs <dist> <origin> [days] [salt]')
  process.exit(2)
}
const assets = join(dist, 'assets')
const now = Date.now()
function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((one) =>
    one.isDirectory() ? walk(join(folder, one.name)) : [join(folder, one.name)],
  )
}
const built = walk(dist)
  .map((file) => relative(dist, file).split('\\').join('/'))
  .filter((name) => name !== 'assets/kept.json')
  .sort()
const digest = createHash('sha256')
digest.update(`${salt}\n`)
for (const name of built) {
  digest.update(
    `${name} ${createHash('sha256')
      .update(readFileSync(join(dist, name)))
      .digest('hex')}\n`,
  )
}
const own = new Set(built.filter((name) => name.startsWith('assets/')).map((name) => name.slice('assets/'.length)))
const base = origin.replace(/\/+$/, '')
const answered = await fetch(`${base}/assets/kept.json?at=${now}`, { cache: 'no-store' })
if (!answered.ok && answered.status !== 404) {
  console.error(`${base}/assets/kept.json answered ${answered.status}; nothing kept, nothing to deploy`)
  process.exit(1)
}
const live = answered.ok ? await answered.json().catch(() => ({ files: {} })) : { files: {} }
const files = Object.fromEntries([...own].map((name) => [name, now]))
const wanted = Object.entries(live.files ?? {})
  .filter(
    ([name, last]) => !own.has(name) && NAME.test(name) && typeof last === 'number' && now - last <= Number(days) * DAY,
  )
  .sort((a, b) => b[1] - a[1])
  .slice(0, MOST)
let gone = 0
async function carry([name, last]) {
  const held = await fetch(`${base}/assets/${name}`)
  if (!held.ok) {
    gone += 1
    return
  }
  const target = join(assets, name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, Buffer.from(await held.arrayBuffer()))
  files[name] = last
}
const queue = [...wanted]
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await carry(next)
  }),
)
const said = digest.digest('hex')
mkdirSync(assets, { recursive: true })
writeFileSync(join(assets, 'kept.json'), JSON.stringify({ digest: said, files }))
const same = live.digest === said
const carried = Object.keys(files).length - own.size
const bytes = Object.keys(files).reduce((sum, name) => sum + statSync(join(assets, name)).size, 0)
console.log(
  `assets: ${own.size} of this build, ${carried} kept from the last ${days} days, ${gone} no longer served, ${Math.round(bytes / 1048576)} MB; ${same ? 'the same build is live' : 'the build differs from the live one'}`,
)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `same=${same}\n`)
