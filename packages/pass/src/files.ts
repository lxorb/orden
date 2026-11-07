import { joined } from './bytes'
import { newKey, open, openBytes, seal, sealBytes, WrongSecret } from './crypto'
import { FILE_PART, MOST_FILE_BYTES } from './file-sizes'

export {
  FILE_PART,
  MOST_FILE_BYTES,
  MOST_FILE_PARTS,
  MOST_SEALED_PART,
  SEALED_EXTRA,
} from './file-sizes'

export interface SealedFile {
  key: string
  parts: Uint8Array<ArrayBuffer>[]
}

export function partsOf(size: number): number {
  return Math.max(1, Math.ceil(size / FILE_PART))
}

function partContext(itemId: string, fileId: string, part: number, parts: number): string[] {
  return parts === 1 ? [itemId, fileId] : [itemId, fileId, String(part)]
}

export async function sealFileKey(
  itemKey: Uint8Array<ArrayBuffer>,
  itemId: string,
  fileId: string,
  fileKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return await seal(itemKey, fileKey, 'file', itemId, fileId, 'key')
}

export async function openFileKey(
  itemKey: Uint8Array<ArrayBuffer>,
  itemId: string,
  fileId: string,
  sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await open(itemKey, sealed, 'file', itemId, fileId, 'key')
  if (key.length !== 32) throw new WrongSecret()
  return key
}

export async function sealFile(
  itemKey: Uint8Array<ArrayBuffer>,
  itemId: string,
  fileId: string,
  bytes: Uint8Array,
): Promise<SealedFile> {
  if (bytes.length > MOST_FILE_BYTES) throw new Error('pass: a file is at most 100 MiB')
  const fileKey = newKey()
  const parts = partsOf(bytes.length)
  const sealed: Uint8Array<ArrayBuffer>[] = []
  for (let part = 0; part < parts; part++) {
    const slice = bytes.subarray(part * FILE_PART, (part + 1) * FILE_PART)
    const context = partContext(itemId, fileId, part, parts)
    sealed.push(await sealBytes(fileKey, slice, 'file', ...context))
  }
  return { key: await sealFileKey(itemKey, itemId, fileId, fileKey), parts: sealed }
}

export async function openFile(
  itemKey: Uint8Array<ArrayBuffer>,
  itemId: string,
  fileId: string,
  key: string,
  parts: readonly Uint8Array[],
  size: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (parts.length !== partsOf(size)) throw new WrongSecret()
  const fileKey = await openFileKey(itemKey, itemId, fileId, key)
  const all = new Uint8Array(size)
  let at = 0
  for (const [part, sealed] of parts.entries()) {
    const context = partContext(itemId, fileId, part, parts.length)
    const plain = await openBytes(fileKey, joined(sealed), 'file', ...context)
    if (at + plain.length > size) throw new WrongSecret()
    all.set(plain, at)
    at += plain.length
  }
  if (at !== size) throw new WrongSecret()
  return all
}

export async function rewrappedFileKey(
  from: Uint8Array<ArrayBuffer>,
  to: Uint8Array<ArrayBuffer>,
  itemId: string,
  fileId: string,
  sealed: string,
): Promise<string> {
  return await sealFileKey(to, itemId, fileId, await openFileKey(from, itemId, fileId, sealed))
}
