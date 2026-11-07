import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

for (const [entry, outfile] of [
  ['src/main.ts', 'dist/ordend.cjs'],
  ['src/hold.ts', 'dist/hold.cjs'],
] as const) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['node-pty', 'bufferutil', 'utf-8-validate'],
    legalComments: 'none',
    logLevel: 'warning',
  })
}

const BUNDLE: readonly [string, string, boolean][] = [
  ['install.sh', 'install.sh', true],
  ['ordend.cjs', 'dist/ordend.cjs', false],
  ['hold.cjs', 'dist/hold.cjs', false],
  ['package.json', 'package.json', false],
  ['agents.sh', 'agents.sh', true],
  ['profile.sh', 'profile.sh', false],
  ['orden-open', 'orden-open', true],
  ['orden-update', 'orden-update', true],
  ['server/ordend.service', 'server/ordend.service', false],
  ['server/cloudflared.service', 'server/cloudflared.service', false],
  ['server/orden-agents.service', 'server/orden-agents.service', false],
]

const BLOCK = 512

function header(name: string, size: number, mode: number): Uint8Array {
  const block = new Uint8Array(BLOCK)
  const put = (at: number, text: string) => {
    block.set(new TextEncoder().encode(text), at)
  }
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, '0')
  put(0, name)
  put(100, octal(mode, 8))
  put(108, octal(0, 8))
  put(116, octal(0, 8))
  put(124, octal(size, 12))
  put(136, octal(0, 12))
  put(156, '0')
  put(257, 'ustar\u000000')
  put(148, '        ')
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(148, `${octal(sum, 7)}\u0000 `)
  return block
}

function tar(files: readonly { name: string; data: Uint8Array; mode: number }[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const file of files) {
    parts.push(header(file.name, file.data.length, file.mode), file.data)
    const pad = (BLOCK - (file.data.length % BLOCK)) % BLOCK
    parts.push(new Uint8Array(pad))
  }
  parts.push(new Uint8Array(BLOCK * 2))
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const files = BUNDLE.map(([name, from, runs]) => ({
  name,
  data: new Uint8Array(readFileSync(from)),
  mode: runs ? 0o755 : 0o644,
}))
writeFileSync('dist/machine.bin', gzipSync(tar(files), { level: 9 }))
