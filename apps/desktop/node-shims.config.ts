import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const NODE = resolve(import.meta.dirname, 'src/lib/chats/providers/node')

export function shimPath(file: string): string {
  return resolve(NODE, file).replaceAll('\\', '/')
}

const SCOPE =
  /[\\/]node_modules[\\/](?:@whiskeysockets[\\/]baileys|libsignal|@hapi[\\/][^\\/]+|@cacheable[\\/][^\\/]+|curve25519-js|lru-cache|p-queue|async-mutex)[\\/]/

const SHIMS: Readonly<Record<string, string>> = {
  crypto: 'crypto.ts',
  zlib: 'zlib.ts',
  stream: 'stream.ts',
  'stream/promises': 'stream-promises.ts',
  events: 'events.ts',
  util: 'util.ts',
  url: 'url.ts',
  os: 'os.ts',
  path: 'path.ts',
  fs: 'fs.ts',
  'fs/promises': 'fs.ts',
  child_process: 'absent.ts',
  http: 'absent.ts',
  https: 'absent.ts',
  readline: 'absent.ts',
  axios: 'axios.ts',
  buffer: 'buffer.ts',
  ws: 'ws.ts',
  pino: 'pino.ts',
  jimp: 'absent.ts',
  sharp: 'absent.ts',
  'music-metadata': 'absent.ts',
  'audio-decode': 'absent.ts',
  'link-preview-js': 'absent.ts',
}

function shimFor(source: string, importer: string): string | null {
  if (!SCOPE.test(importer)) return null
  const bare = source.replace(/^node:/, '')
  const file = SHIMS[bare]
  return file ? shimPath(file) : null
}

const ASSERT =
  "(function (value, message) { if (!value) throw new Error(message || 'an assertion failed') })"

function injected(code: string): string {
  const heads: string[] = []
  const common = !/^\s*(?:import|export)\b/m.test(code)
  const declares = (name: string) =>
    new RegExp(
      `\\b(?:(?:const|let|var|function|class)\\s+${name}\\b|import\\s+${name}\\b|import\\s*\\{[^}]*\\b${name}\\b)`,
    ).test(code)
  const from = (file: string) => JSON.stringify(shimPath(file))
  if (/\bBuffer\b/.test(code) && !declares('Buffer'))
    heads.push(
      common
        ? `var Buffer = require(${from('buffer.ts')}).Buffer;`
        : `import { Buffer } from ${from('buffer.ts')};`,
    )
  if (/(?<![.\w$])process\b/.test(code) && !declares('process'))
    heads.push(
      common
        ? `var process = require(${from('process.ts')}).default;`
        : `import process from ${from('process.ts')};`,
    )
  const timers = code.replace(/\.(unref|ref)\(\)/g, '.$1?.()')
  const body = common ? timers.replace(/require\((['"])assert\1\)/g, ASSERT) : timers
  return heads.length === 0 ? body : `${heads.join('\n')}\n${body}`
}

export function whatsappShims(): Plugin {
  return {
    name: 'orden-whatsapp-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      return shimFor(source, importer)
    },
    transform(code, id) {
      if (!SCOPE.test(id) || !/\.(?:c|m)?js$/.test(id.replace(/\?.*$/, ''))) return null
      const next = injected(code)
      return next === code ? null : { code: next, map: null }
    },
  }
}
