import {
  DirectoryBackup,
  DirectoryBackupGateway,
  type DirectoryBackupGatewayBinding,
  type DirectoryBackupRecord,
} from '@cloudflare/sandbox'
import { WorkerEntrypoint } from 'cloudflare:workers'
import machine from '../../machine/dist/machine.bin'
import worker from './index'
import type { Env } from './sync-server/src/api'
import { carry, wire } from './sync-server-machines/src/api'
interface Exports {
  DirectoryBackupGateway: DirectoryBackupGatewayBinding
  Egress: (options: { props: Record<string, never> }) => Fetcher
}

const HOMES = 'HOMES'

const DENIED = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?(::1|f[cd][0-9a-f]{2}:|fe80:)/i,
  /^metadata(\.google\.internal)?$/i,
  /\.internal$/i,
  /\.local$/i,
]

export class Egress extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const host = new URL(request.url).hostname.replace(/\.+$/, '')
    if (DENIED.some((one) => one.test(host))) {
      return new Response('Origin is disallowed', { status: 520 })
    }
    return await fetch(request)
  }
}

carry(machine)

wire({
  backups: (container, ctx) => {
    const exports = ctx.exports as unknown as Exports
    const homes = new DirectoryBackup(container, exports.DirectoryBackupGateway, {
      binding: HOMES,
    })
    return {
      intercept: () => homes.intercept(),
      backup: async (dir, name) => {
        const record = await homes.backup({
          dir,
          name,
          exclude: ['.cache/', 'node_modules/', '.npm/_cacache/'],
        })
        return JSON.stringify({ ...record, key: `${record.id}.tar.zst` })
      },
      restore: (record) => homes.restore(JSON.parse(record) as DirectoryBackupRecord),
    }
  },
  outbound: (ctx) => (ctx.exports as unknown as Exports).Egress({ props: {} }),
})

export { DirectoryBackupGateway }
export { AccountHub, AppRelay, ChatLog, NoteRoom } from './index'
export { Machine } from './sync-server-machines/src/api'
export default worker
