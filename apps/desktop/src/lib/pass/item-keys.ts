import type { Envelope } from '@orden/pass/types'

export async function attachmentsUnder(
  envelope: Envelope,
  id: string,
  from: readonly Uint8Array<ArrayBuffer>[],
  to: Uint8Array<ArrayBuffer>,
): Promise<Envelope> {
  if (!envelope.attachments.length) return envelope
  const { openFileKey, sealFileKey } = await import('@orden/pass/files')
  const attachments = await Promise.all(
    envelope.attachments.map(async (one) => {
      for (const key of [to, ...from]) {
        try {
          const fileKey = await openFileKey(key, id, one.id, one.key)
          return key === to ? one : { ...one, key: await sealFileKey(to, id, one.id, fileKey) }
        } catch {
          continue
        }
      }
      return one
    }),
  )
  return { ...envelope, attachments }
}
