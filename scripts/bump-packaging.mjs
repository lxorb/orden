#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = process.env.GITHUB_REPOSITORY || 'lxorb/orden'

const asked = process.argv[2]?.replace(/^v/, '')
const edge = asked === 'edge'
if (!edge && !/^\d+\.\d+\.\d+$/.test(asked ?? '')) {
  throw new Error('usage: bump-packaging.mjs <version> | edge [<version>]')
}
const tag = edge ? 'edge' : `v${asked}`

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
  headers: {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
})
if (!response.ok) throw new Error(`${tag}: the release page answered ${response.status}`)
const release = await response.json()
if (!edge && (release.draft || release.prerelease)) {
  throw new Error(`${tag} is not a stable release`)
}

const asset = 'Orden'
const version = edge
  ? (process.argv[3] ??
    release.assets.map((one) => /^Orden-(.+)-linux-x64\.deb$/.exec(one.name)?.[1]).find(Boolean))
  : asked
if (!version) throw new Error(`${tag}: no Linux .deb on the release`)

const digest = (name) => {
  const found = release.assets.find((one) => one.name === name)
  const hex = /^sha256:([0-9a-f]{64})$/.exec(found?.digest ?? '')?.[1]
  if (!hex) throw new Error(`${tag}: the release reports no sha256 for ${name}`)
  return hex
}
const file = (arch, kind) => `${asset}-${version}-${arch}${kind}`
const sri = (hex) => `sha256-${Buffer.from(hex, 'hex').toString('base64')}`
const download = `https://github.com/${REPO}/releases/download/${tag}`

if (edge) {
  const pin = {
    version,
    tag,
    asset,
    hashes: {
      'x86_64-linux': sri(digest(file('linux-x64', '.deb'))),
      'aarch64-linux': sri(digest(file('linux-arm64', '.deb'))),
    },
  }
  writeFileSync(join(ROOT, 'packaging/nix/edge.json'), `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`nix edge on ${version}`)
  process.exit(0)
}

const OLD = String.raw`releases/download/v[0-9][^/'"]*/[A-Za-z]+-[0-9][^-]*`

const pending = new Map()
const edit = (path, rewrites) => {
  let text = pending.get(path) ?? readFileSync(join(ROOT, 'packaging', path), 'utf8')
  for (const [pattern, replacement, times = 1] of rewrites) {
    const every = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
    const found = text.match(every)?.length ?? 0
    if (found !== times) throw new Error(`${path}: ${pattern} matched ${found} times, not ${times}`)
    text = text.replace(every, replacement)
  }
  pending.set(path, text)
}

const inRelease = (field) => new RegExp(String.raw`(?<=release = \{[^}]*?)(\s*${field} = )"[^"]*";`)

const flake = readFileSync(join(ROOT, 'packaging/nix/flake.nix'), 'utf8')
const current = /release = \{[^}]*?\s*version = "([^"]+)";/.exec(flake)?.[1]
if (current && /^\d+\.\d+\.\d+$/.test(current) && newer(current, version)) {
  throw new Error(`the packaging is on ${current} already, which is newer than ${version}`)
}

const debX64 = digest(file('linux-x64', '.deb'))
const debArm64 = digest(file('linux-arm64', '.deb'))

edit('nix/flake.nix', [
  [inRelease('pname'), '$1"orden";'],
  [inRelease('version'), `$1"${version}";`],
  [inRelease('tag'), `$1"${tag}";`],
  [inRelease('asset'), `$1"${asset}";`],
  [/(suffix = "x64";\s*hash = )"[^"]*";/, `$1"${sri(debX64)}";`],
  [/(suffix = "arm64";\s*hash = )"[^"]*";/, `$1"${sri(debArm64)}";`],
])

edit('aur/nib-bin/PKGBUILD', [
  [/^pkgver=.*$/m, `pkgver=${version}`],
  [/^pkgrel=.*$/m, 'pkgrel=1'],
  [/^sha256sums_x86_64=.*$/m, `sha256sums_x86_64=('${debX64}')`],
  [/^sha256sums_aarch64=.*$/m, `sha256sums_aarch64=('${debArm64}')`],
])
edit('aur/nib-bin/.SRCINFO', [
  [/^(\tpkgver = ).*$/m, `$1${version}`],
  [/^(\tpkgrel = ).*$/m, (_, key) => `${key}1`],
  [/^(\tprovides = (?:orden|nib)=).*$/m, `$1${version}`, 2],
  [/^(\tsource_x86_64 = nib\.deb::).*$/m, `$1${download}/${file('linux-x64', '.deb')}`],
  [/^(\tsha256sums_x86_64 = ).*$/m, `$1${debX64}`],
  [/^(\tsource_aarch64 = nib\.deb::).*$/m, `$1${download}/${file('linux-arm64', '.deb')}`],
  [/^(\tsha256sums_aarch64 = ).*$/m, `$1${debArm64}`],
])

edit('snap/snapcraft.yaml', [
  [/^version: .*$/m, `version: '${version}'`],
  [/^(\s*- on amd64: )https:\/\/.*\.deb$/m, `$1${download}/${file('linux-x64', '.deb')}`],
  [/^(\s*- on arm64: )https:\/\/.*\.deb$/m, `$1${download}/${file('linux-arm64', '.deb')}`],
  [/(on amd64: sha256\/)[0-9a-f]{64}/, `$1${debX64}`],
  [/(on arm64: sha256\/)[0-9a-f]{64}/, `$1${debArm64}`],
  [/^( *source-checksum: sha256\/)[0-9a-f]{64}$/m, `$1${debX64}`],
])

edit('scoop/orden.json', [
  [/^( {4}"version": )"[^"]*",$/m, `$1"${version}",`],
  ...['x64', 'arm64'].map((arch) => [
    new RegExp(
      String.raw`(            "url": "https://github\.com/[^/]+/[^/]+/)${OLD}(-windows-${arch}-setup\.exe#/dl\.7z",\n            "hash": )"[0-9a-f]{64}"`,
    ),
    `$1releases/download/${tag}/Orden-${version}$2"${digest(file(`windows-${arch}`, '-setup.exe'))}"`,
  ]),
])

edit('chocolatey/orden.nuspec', [
  [/<version>[^<]*<\/version>/, `<version>${version}</version>`],
  [/(orden@v)[0-9][^/]*/, `$1${version}`],
  [/(releases\/tag\/v)[0-9][^<]*</, `$1${version}<`],
])
edit('chocolatey/nib.nuspec', [
  [/<version>[^<]*<\/version>/, `<version>${version}</version>`],
  [/(<dependency id="orden" version=")[^"]*"/, `$1${version}"`],
])
edit('chocolatey/tools/chocolateyinstall.ps1', [
  ...['x64', 'arm64'].map((arch) => [
    new RegExp(
      String.raw`'https://github\.com/[^/]+/[^/]+/${OLD}(-windows-${arch}\.msi'[^]*?')[0-9A-Fa-f]{64}'`,
    ),
    `'${download}/Orden-${version}$1${digest(file(`windows-${arch}`, '.msi')).toUpperCase()}'`,
  ]),
])

edit('homebrew/orden.rb', [
  [/^( {2}version )"[^"]*"$/m, `$1"${version}"`],
  [/^( {2}sha256 arm: {3})"[0-9a-f]{64}",$/m, `$1"${digest(file('macos-arm64', '.dmg'))}",`],
  [/^( {9}intel: )"[0-9a-f]{64}"$/m, `$1"${digest(file('macos-x64', '.dmg'))}"`],
])

for (const [path, text] of pending) writeFileSync(join(ROOT, 'packaging', path), text)
console.log(`packaging on ${version}${current && current !== version ? `, from ${current}` : ''}`)
