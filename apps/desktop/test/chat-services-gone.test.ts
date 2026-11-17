import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const PACKAGES = [
  /^@whiskeysockets\//,
  /^baileys$/,
  /^libsignal/,
  /^@signalapp\//,
  /^@mtcute\//,
  /^telegram$/,
  /^gramjs$/,
  /^@slack\//,
  /^discord\.js$/,
  /^@discordjs\//,
  /^imapflow$/,
  /^imap$/,
  /^node-imap$/,
  /^nodemailer$/,
  /^mailparser$/,
  /^@azure\/msal/,
  /^googleapis$/,
  /^pino$/,
  /^protobufjs$/,
  /^long$/,
]

const SERVICES = /whatsapp|signal|telegram|slack|discord|imap|smtp|gmail|microsoft|mail|sidecar/i

const SKIP = /^(?:node_modules|target|dist|gen|locales|\.[^.]+)$/

function files(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.test(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, keep, out)
    else if (keep(path)) out.push(path)
  }
  return out
}

const read = (path: string) => readFileSync(path, 'utf8')
const known = (name: string) => PACKAGES.some((pattern) => pattern.test(name))

const manifests = [
  join(ROOT, 'package.json'),
  ...['apps', 'packages', 'services'].flatMap((group) =>
    readdirSync(join(ROOT, group))
      .map((one) => join(ROOT, group, one, 'package.json'))
      .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile()),
  ),
]

describe('chats from other services', () => {
  test('no package of the workspace depends on a client for one', () => {
    const held = manifests.flatMap((path) => {
      const manifest = JSON.parse(read(path)) as Record<string, Record<string, string> | undefined>
      const names = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((field) => Object.keys(manifest[field] ?? {}))
        .concat(
          Object.keys(
            (manifest.pnpm as { patchedDependencies?: object } | undefined)?.patchedDependencies ??
              {},
          ),
        )
      return names.filter(known).map((name) => `${relative(ROOT, path)}: ${name}`)
    })
    expect(held).toEqual([])
  })

  test('the lockfile installs none', () => {
    const lock = read(join(ROOT, 'pnpm-lock.yaml'))
    const installed = [...lock.matchAll(/^ {2}'?(@?[^@\s'][^@\s']*)@[^:\s]+'?:$/gm)].map(
      ([, name = '']) => name,
    )
    expect([...new Set(installed.filter(known))]).toEqual([])
  })

  test('no source imports one', () => {
    const source = [
      join(ROOT, 'apps/desktop/src'),
      ...['packages', 'services'].flatMap((group) =>
        readdirSync(join(ROOT, group)).map((one) => join(ROOT, group, one, 'src')),
      ),
    ].filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    const importing = source.flatMap((dir) =>
      files(dir, (path) => /\.(ts|svelte|js)$/.test(path)).flatMap((path) =>
        [...read(path).matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)]
          .map(([, name = '']) => name)
          .filter(known)
          .map((name) => `${relative(ROOT, path)}: ${name}`),
      ),
    )
    expect(importing).toEqual([])
  })

  test('no file of the chats is named for one', () => {
    const named = [
      join(ROOT, 'packages/chats/src'),
      join(ROOT, 'apps/desktop/src/lib/chats-client'),
      join(ROOT, 'apps/desktop/src-tauri/src'),
    ].flatMap((dir) =>
      files(dir, (path) => SERVICES.test(relative(dir, path))).map((path) => relative(ROOT, path)),
    )
    expect(named).toEqual([])
  })

  test('the chats package offers no entry for one', () => {
    const manifest = JSON.parse(read(join(ROOT, 'packages/chats/package.json'))) as {
      exports: Record<string, string>
    }
    expect(Object.keys(manifest.exports).filter((entry) => SERVICES.test(entry))).toEqual([])
  })

  test('the app registers no command that reaches one', () => {
    const lib = read(join(ROOT, 'apps/desktop/src-tauri/src/lib.rs'))
    for (const gone of ['mail_socket', 'wire_socket', 'chat_request', 'sidecar', 'oauth_loopback'])
      expect(lib, gone).not.toContain(gone)
  })

  test('no workflow or script drives one', () => {
    const driven = [
      ...files(join(ROOT, '.github/workflows'), () => true),
      ...files(join(ROOT, 'scripts'), () => true),
      ...files(join(ROOT, 'apps/desktop/test/e2e'), () => true),
    ]
      .map((path) => relative(ROOT, path))
      .filter((path) => /whatsapp|signal|telegram|slack|add-chat|chats-services|mail-/i.test(path))
    expect(driven).toEqual([])
  })
})
