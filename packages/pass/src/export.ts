import { base64, randomBytes, unbase64 } from './bytes'
import type { KdfParams } from './crypto'
import { PASSWORD_KDF, WrongSecret, kdfParamsIn, openText, seal, stretch, subkey } from './crypto'
import { csvText } from './import/csv'
import type { Envelope, VaultMeta } from './types'

export const EXPORT_FORMAT = 'orden-pass'
export const SEALED_FORMAT = 'orden-pass-sealed'

export interface ExportedVault {
  meta: VaultMeta
  items: Envelope[]
}

export interface Exported {
  format: typeof EXPORT_FORMAT
  version: 1
  vaults: ExportedVault[]
}

export interface SealedExport {
  format: typeof SEALED_FORMAT
  version: 1
  kdf: { salt: string } & KdfParams
  sealed: string
}

const SALT = 16
const EXPORT_INFO = 'orden pass export'

export const CSV_COLUMNS = ['name', 'url', 'email', 'username', 'password', 'totp', 'note'] as const

export function spreadsheetSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

export function exportJson(vaults: readonly ExportedVault[]): string {
  const exported: Exported = {
    format: EXPORT_FORMAT,
    version: 1,
    vaults: vaults.map(({ meta, items }) => ({
      meta,
      items: items.map((item) => ({ ...item, attachments: [] })),
    })),
  }
  return JSON.stringify(exported, null, 2)
}

export function exportCsv(items: readonly Envelope[]): string {
  const rows: string[][] = [[...CSV_COLUMNS]]
  for (const { content, trashed } of items) {
    if (content.kind !== 'login' || trashed !== null) continue
    rows.push([
      spreadsheetSafe(content.title),
      spreadsheetSafe(content.websites.map((website) => website.url).join(', ')),
      spreadsheetSafe(content.email),
      spreadsheetSafe(content.username),
      content.password,
      content.totp,
      spreadsheetSafe(content.note),
    ])
  }
  return csvText(rows)
}

async function exportKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  return await subkey(await stretch(passphrase, salt, params), EXPORT_INFO)
}

export async function sealExport(
  text: string,
  passphrase: string,
  params: KdfParams = PASSWORD_KDF,
): Promise<string> {
  const salt = randomBytes(SALT)
  const key = await exportKey(passphrase, salt, params)
  const sealed: SealedExport = {
    format: SEALED_FORMAT,
    version: 1,
    kdf: { salt: base64(salt), m: params.m, t: params.t, p: params.p },
    sealed: await seal(key, text, 'export'),
  }
  return JSON.stringify(sealed)
}

export class NotSealedExport extends Error {
  override name = 'NotSealedExport'
}

function sealedIn(text: string): {
  salt: Uint8Array<ArrayBuffer>
  params: KdfParams
  sealed: string
} {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new NotSealedExport('pass: not a sealed export')
  }
  if (typeof value !== 'object' || value === null)
    throw new NotSealedExport('pass: not a sealed export')
  const { format, version, kdf, sealed } = value as Record<string, unknown>
  if (format !== SEALED_FORMAT || typeof sealed !== 'string') {
    throw new NotSealedExport('pass: not a sealed export')
  }
  if (version !== 1) throw new NotSealedExport('pass: a sealed export from a newer Orden')
  const params = kdfParamsIn(kdf)
  const salt =
    typeof kdf === 'object' && kdf !== null ? (kdf as Record<string, unknown>).salt : null
  if (params === null || typeof salt !== 'string') {
    throw new NotSealedExport('pass: the sealed export names no usable key stretching')
  }
  let saltBytes: Uint8Array<ArrayBuffer>
  try {
    saltBytes = unbase64(salt)
  } catch {
    throw new NotSealedExport('pass: the sealed export names no usable key stretching')
  }
  return { salt: saltBytes, params, sealed }
}

export function isSealedExport(text: string): boolean {
  try {
    sealedIn(text)
    return true
  } catch {
    return false
  }
}

export async function openExport(text: string, passphrase: string): Promise<string> {
  const { salt, params, sealed } = sealedIn(text)
  let key: Uint8Array<ArrayBuffer>
  try {
    key = await exportKey(passphrase, salt, params)
  } catch (error) {
    if (error instanceof WrongSecret) throw new NotSealedExport(error.message)
    throw error
  }
  return await openText(key, sealed, 'export')
}
