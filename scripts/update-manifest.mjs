import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'lxorb/nibeditor'

const PLATFORMS = [
  { key: 'windows-x86_64', match: (path) => /windows-x64/.test(path) && path.endsWith('.exe.sig') },
  {
    key: 'windows-aarch64',
    match: (path) => /windows-arm64/.test(path) && path.endsWith('.exe.sig'),
  },
  {
    key: 'linux-x86_64',
    match: (path) => /linux-x64/.test(path) && path.endsWith('.AppImage.sig'),
  },
  {
    key: 'linux-aarch64',
    match: (path) => /linux-arm64/.test(path) && path.endsWith('.AppImage.sig'),
  },
  ...['deb', 'rpm'].flatMap((kind) => [
    {
      key: `linux-x86_64-${kind}`,
      match: (path) => /linux-x64/.test(path) && path.endsWith(`.${kind}.sig`),
    },
    {
      key: `linux-aarch64-${kind}`,
      match: (path) => /linux-arm64/.test(path) && path.endsWith(`.${kind}.sig`),
    },
  ]),
]

const MAC_KEYS = ['darwin-universal', 'darwin-aarch64', 'darwin-x86_64']

const [, , tag, version, root] = process.argv
if (!tag || !version || !root) {
  console.error('usage: update-manifest.mjs <tag> <version> <artifacts-dir>')
  process.exit(1)
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

const files = walk(root).map((path) => path.split('\\').join('/'))
const platforms = {}

for (const { key, match } of PLATFORMS) {
  const signature = files.find(match)
  if (!signature) continue

  const bundle = signature.slice(0, -'.sig'.length)

  platforms[key] = {
    signature: readFileSync(signature, 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${bundle.split('/').pop()}`,
  }
}

const mac = files.find((path) => path.endsWith('.app.tar.gz.sig'))
if (mac) {
  const bundle = mac.slice(0, -'.sig'.length)
  const entry = {
    signature: readFileSync(mac, 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${bundle.split('/').pop()}`,
  }

  for (const key of MAC_KEYS) platforms[key] = entry
}

if (!Object.keys(platforms).length) {
  console.error('no signed bundles found - is TAURI_SIGNING_PRIVATE_KEY set?')
  process.exit(1)
}

process.stdout.write(
  `${JSON.stringify(
    {
      version,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
)
