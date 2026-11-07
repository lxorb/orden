import { openFile, partsOf, sealFile } from '@orden/pass/files'
import type { Attachment, Item } from '@orden/pass/types'
import type { FileApi } from './file-api'
import { fileApi } from './file-api'
import type { QueueRows } from './file-queue'
import { droppedWaiting, queuedRemoval, queuedUpload } from './file-queue'
import type { FilePartRow } from './local'
import { dropFileParts, readFileParts, writeFileParts } from './local'
import { newId } from './rows'

export interface Picked {
  name: string
  type: string
  bytes: Uint8Array
}

export class NotHere extends Error {
  constructor() {
    super('pass: this file has not reached this device yet')
    this.name = 'NotHere'
  }
}

export async function accountFiles(): Promise<FileApi | null> {
  const [{ account }, { BASE }] = await Promise.all([import('../account.svelte'), import('../api')])
  return account.user && account.token ? fileApi(BASE, account.token) : null
}

export async function keptAttachment(
  rows: QueueRows,
  itemKey: Uint8Array<ArrayBuffer>,
  item: string,
  picked: Picked,
): Promise<Attachment> {
  const id = newId()
  const sealed = await sealFile(itemKey, item, id, picked.bytes)
  const parts = sealed.parts.length
  await writeFileParts(sealed.parts.map((bytes, part) => ({ item, file: id, part, parts, bytes })))
  await queuedUpload(rows, item, id, parts)
  return {
    id,
    name: picked.name.trim() || 'file',
    type: picked.type || 'application/octet-stream',
    size: picked.bytes.length,
    key: sealed.key,
  }
}

async function fetchedParts(
  remote: FileApi,
  item: Item,
  attachment: Attachment,
): Promise<FilePartRow[]> {
  const parts = partsOf(attachment.size)
  const rows: FilePartRow[] = []
  for (let part = 0; part < parts; part++) {
    const bytes = await remote.get(item.vault, item.id, attachment.id, part)
    rows.push({ item: item.id, file: attachment.id, part, parts, bytes })
  }
  await writeFileParts(rows)
  return rows
}

export async function openedAttachment(
  itemKey: Uint8Array<ArrayBuffer>,
  item: Item,
  attachment: Attachment,
  remote: () => Promise<FileApi | null> = accountFiles,
): Promise<Uint8Array<ArrayBuffer>> {
  let rows = await readFileParts(item.id, attachment.id)
  if (rows.length !== partsOf(attachment.size)) {
    const api = await remote()
    if (!api) throw new NotHere()
    rows = await fetchedParts(api, item, attachment)
  }
  const sorted = [...rows].sort((a, b) => a.part - b.part).map((one) => one.bytes)
  return await openFile(itemKey, item.id, attachment.id, attachment.key, sorted, attachment.size)
}

export async function forgottenAttachment(
  rows: QueueRows,
  vault: string,
  item: string,
  file: string,
): Promise<void> {
  await dropFileParts(item, file)
  await queuedRemoval(rows, vault, item, file)
}

export async function forgottenItemFiles(rows: QueueRows, items: readonly string[]): Promise<void> {
  for (const item of items) await dropFileParts(item)
  await droppedWaiting(rows, items)
}
