#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const APP = fileURLToPath(new URL('../apps/desktop/src-tauri/', import.meta.url))
const PIN = join(APP, 'opencode.json')
const NIX_PIN = fileURLToPath(new URL('../packaging/nix/opencode.json', import.meta.url))
const LICENSES = fileURLToPath(new URL('../apps/desktop/src/lib/opencode-client/src/licences.txt', import.meta.url))
const REGISTRY = 'https://registry.npmjs.org'
const PLATFORMS = {
  'x86_64-unknown-linux-gnu': 'linux-x64-baseline',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64-baseline',
  'x86_64-pc-windows-msvc': 'windows-x64-baseline',
  'aarch64-pc-windows-msvc': 'windows-arm64',
}
const UPSTREAM = {
  opencode: (version) => `https://raw.githubusercontent.com/sst/opencode/v${version}/LICENSE`,
  bun: (version) => `https://raw.githubusercontent.com/oven-sh/bun/bun-v${version}/LICENSE.md`,
}

const pin = () => JSON.parse(readFileSync(PIN, 'utf8'))
const windows = (triple) => triple.includes('windows')
const binaryOf = (triple) => `binaries/opencode-${triple}${windows(triple) ? '.exe' : ''}`
const platformOf = (triple) => {
  const platform = PLATFORMS[triple]
  if (!platform) throw new Error(`OpenCode is not built for ${triple}; known: ${Object.keys(PLATFORMS).join(', ')}`)
  return platform
}
async function get(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}
const tarball = (platform, version) => `${REGISTRY}/opencode-${platform}/-/opencode-${platform}-${version}.tgz`
function unpacked(gzipped, wanted) {
  const tar = gunzipSync(gzipped)
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar.toString('utf8', at, at + 100).replace(/\0.*$/s, '')
    if (!name) break
    const size = parseInt(
      tar
        .toString('utf8', at + 124, at + 136)
        .replace(/\0.*$/s, '')
        .trim() || '0',
      8,
    )
    if (name === wanted) return tar.subarray(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error(`${wanted} is not in the package`)
}
async function fetchOne(triple, { version, sha512 }) {
  const platform = platformOf(triple)
  const gzipped = Buffer.from(await (await get(tarball(platform, version))).arrayBuffer())
  const held = createHash('sha512').update(gzipped).digest('base64')
  if (held !== sha512[platform]) {
    throw new Error(`opencode-${platform} ${version}: sha512 ${held}, pinned ${sha512[platform]}`)
  }
  const binary = unpacked(gzipped, `package/bin/opencode${windows(triple) ? '.exe' : ''}`)
  const out = join(APP, binaryOf(triple))
  mkdirSync(join(APP, 'binaries'), { recursive: true })
  writeFileSync(out, binary)
  chmodSync(out, 0o755)
  console.log(`OpenCode ${version} for ${triple}: ${out} (${binary.length} bytes)`)
  return out
}
function config(triple) {
  return windows(triple) ? { bundle: { externalBin: ['binaries/orden-shell'] } } : {}
}
async function sizeOf(url) {
  const response = await fetch(url, { headers: { range: 'bytes=0-0' } })
  await response.arrayBuffer()
  const size = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1])
  if (response.status !== 206 || !Number.isSafeInteger(size) || size <= 0) throw new Error(`${url} says no size`)
  return size
}
async function latest() {
  return (await (await get(`${REGISTRY}/opencode-ai/latest`)).json()).version
}
async function licenses({ version, bun }) {
  const [opencode, runtime] = await Promise.all(
    [UPSTREAM.opencode(version), UPSTREAM.bun(bun)].map(async (url) => (await get(url)).text()),
  )
  const text = [
    `Orden ships OpenCode ${version} (https://opencode.ai), which runs on Bun ${bun} (https://bun.sh).`,
    '',
    `# OpenCode ${version}`,
    '',
    opencode.trim(),
    '',
    `# Bun ${bun}, with the projects it is built from`,
    '',
    runtime.trim(),
    '',
  ].join('\n')
  writeFileSync(LICENSES, text)
}
async function bump() {
  const now = pin()
  const version = await latest()
  if (version === now.version) {
    console.log(`OpenCode is on ${version}, the newest`)
    return false
  }
  const sha512 = {}
  const bytes = {}
  for (const platform of Object.values(PLATFORMS)) {
    const meta = await (await get(`${REGISTRY}/opencode-${platform}/${version}`)).json()
    const [kind, digest] = String(meta.dist?.integrity ?? '').split('-')
    if (kind !== 'sha512' || !digest) throw new Error(`opencode-${platform} ${version} names no sha512`)
    sha512[platform] = digest
    bytes[platform] = await sizeOf(tarball(platform, version))
  }
  const next = { version, bun: now.bun, sha512, bytes }
  const binary = await fetchOne('x86_64-unknown-linux-gnu', next)
  const said = readFileSync(binary)
    .toString('latin1')
    .match(/bun-v(\d+\.\d+\.\d+)/)
  if (!said) throw new Error(`OpenCode ${version} does not say which Bun it runs on`)
  next.bun = said[1]
  for (const file of [PIN, NIX_PIN]) writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  await licenses(next)
  console.log(`OpenCode ${now.version} -> ${version}, Bun ${now.bun} -> ${next.bun}`)
  return true
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'fetch') {
  const triples = rest[0] === 'all' ? Object.keys(PLATFORMS) : rest
  if (!triples.length) throw new Error('usage: opencode.mjs fetch <target triple>... | all')
  for (const triple of triples) await fetchOne(triple, pin())
} else if (command === 'config') {
  platformOf(rest[0] ?? '')
  console.log(JSON.stringify(config(rest[0])))
} else if (command === 'licenses') {
  await licenses(pin())
} else if (command === 'newest') {
  const [pinned, newest] = [pin().version, await latest()]
  if (pinned !== newest) {
    console.error(`OpenCode is pinned to ${pinned}, but ${newest} is out: run the opencode-bump workflow first`)
    process.exit(1)
  }
  console.log(`OpenCode ${pinned} is the newest`)
} else if (command === 'bump') {
  const changed = await bump()
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' })
} else {
  throw new Error('usage: opencode.mjs fetch <triple>... | all, config <triple>, licenses, newest, bump')
}
