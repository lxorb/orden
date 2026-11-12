import { Hono } from 'hono'
import type { Env } from '../../../sync-server/src/api'

let bytes: ArrayBuffer | null = null
let digest: Promise<string> | null = null

export function carry(bundle: ArrayBuffer): void {
  bytes = bundle
  digest = null
}

export async function bundleSha(): Promise<string | null> {
  if (!bytes) return null
  const carried = bytes
  digest ??= crypto.subtle
    .digest('SHA-256', carried)
    .then((hash) =>
      [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
  return await digest
}

export const machineBundle = new Hono<{ Bindings: Env }>()

machineBundle.get('/current', async (context) => {
  const sha = await bundleSha()
  return sha ? context.text(sha) : context.text('no bundle', 404)
})

machineBundle.get('/:file', async (context) => {
  const sha = await bundleSha()
  if (!sha || !bytes || context.req.param('file') !== `${sha}.bin`) {
    return context.text('no such bundle', 404)
  }
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
