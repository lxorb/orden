import { base64, fromUtf8, joined, randomBytes, same, unbase64 } from './bytes'
import type { KdfParams, Pair } from './crypto'
import {
  kdfParamsIn,
  newKey,
  newPair,
  open,
  openBytes,
  openText,
  PASSWORD_KDF,
  seal,
  sealBytes,
  stretch,
  subkey,
  unwrapWith,
  WrongSecret,
  wrapTo,
} from './crypto'
import { envelopeIn, vaultMetaIn } from './envelope'
import { KdfTooCostly, MOST_KDF_MEMORY, MOST_KDF_PASSES } from './kdf'
import type { Keyring, PasswordSeal, SignSeal } from './keyring'
import { newSigner, type Signer } from './sign'
import type { Envelope, VaultMeta } from './types'

export { keyringIn, type Keyring, type PasswordSeal, type SignSeal } from './keyring'

export interface Opened {
  root: Uint8Array<ArrayBuffer>
  pair: Pair
  signer: Signer | null
}

export interface Sealing {
  keyVersion: number
  rev: number
}

export interface OpenedItem {
  envelope: Envelope
  itemKey: Uint8Array<ArrayBuffer>
  rev: number | null
}

const SALT = 16
const MARK = [0x6f, 0x70, 0x69, 0x32]
const HEAD = 8
const CHECKSUM = 2
const RECOVERY_BYTES = 32
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_LENGTH = Math.ceil(((RECOVERY_BYTES + CHECKSUM) * 8) / 5)

async function checksumOf(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest.slice(0, CHECKSUM))
}

function base32(bytes: Uint8Array): string {
  let text = ''
  let bits = 0
  let held = 0
  for (const one of bytes) {
    held = (held << 8) | one
    bits += 8
    while (bits >= 5) {
      bits -= 5
      text += CROCKFORD[(held >> bits) & 31] ?? ''
    }
    held &= (1 << bits) - 1
  }
  if (bits > 0) text += CROCKFORD[(held << (5 - bits)) & 31] ?? ''
  return text
}

function unbase32(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  const bytes = new Uint8Array(length)
  let bits = 0
  let held = 0
  let at = 0
  for (const letter of text) {
    const value = CROCKFORD.indexOf(letter)
    if (value < 0) return null
    held = (held << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      if (at >= length) return null
      bytes[at++] = (held >> bits) & 255
    }
    held &= (1 << bits) - 1
  }
  return at === length && held === 0 ? bytes : null
}

export async function recoveryCode(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (bytes.length !== RECOVERY_BYTES) throw new Error('pass: a recovery key is 32 bytes')
  const letters = base32(joined(bytes, await checksumOf(bytes)))
  return (letters.match(/.{1,4}/g) ?? []).join('-')
}

export async function recoveryKey(code: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const letters = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (letters.length !== RECOVERY_LENGTH) return null
  const all = unbase32(letters, RECOVERY_BYTES + CHECKSUM)
  if (all === null) return null
  const bytes = all.slice(0, RECOVERY_BYTES)
  return same(all.slice(RECOVERY_BYTES), await checksumOf(bytes)) ? bytes : null
}

async function passwordKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  return await subkey(await stretch(password, salt, params), 'orden pass password')
}

async function recoverySealKey(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return await subkey(bytes, 'orden pass recovery')
}

function passwordContext(pub: string, at: number | undefined): string[] {
  return at === undefined ? ['password'] : ['password', pub, String(at)]
}

async function passwordSealOf(
  root: Uint8Array<ArrayBuffer>,
  password: string,
  params: KdfParams,
  pub: string,
): Promise<PasswordSeal> {
  const salt = randomBytes(SALT)
  const key = await passwordKey(password, salt, params)
  const at = Date.now()
  const sealed = await seal(key, root, 'root', ...passwordContext(pub, at))
  return { salt: base64(salt), ...params, sealed, at }
}

export function isOldPasswordSeal(keyring: Keyring): boolean {
  return keyring.password.at === undefined
}

async function signSealOf(root: Uint8Array<ArrayBuffer>, signer: Signer): Promise<SignSeal> {
  return {
    pub: signer.pub,
    private: await seal(root, JSON.stringify(signer.priv), 'sign', signer.pub),
  }
}

function laterThan(keyring: Keyring): number {
  return Math.max(Date.now(), keyring.at + 1)
}

async function recoverySealOf(
  root: Uint8Array<ArrayBuffer>,
): Promise<{ sealed: string; recovery: string }> {
  const bytes = newKey()
  return {
    sealed: await seal(await recoverySealKey(bytes), root, 'root', 'recovery'),
    recovery: await recoveryCode(bytes),
  }
}

export async function newKeyring(
  password: string,
  params: KdfParams = PASSWORD_KDF,
): Promise<{ keyring: Keyring; opened: Opened; recovery: string }> {
  const root = newKey()
  const pair = await newPair()
  const signer = await newSigner()
  const { sealed, recovery } = await recoverySealOf(root)
  const keyring: Keyring = {
    v: 1,
    pub: pair.pub,
    private: await seal(root, JSON.stringify(pair.priv), 'private', pair.pub),
    sign: await signSealOf(root, signer),
    password: await passwordSealOf(root, password, params, pair.pub),
    recovery: sealed,
    at: Date.now(),
  }
  return { keyring, opened: { root, pair, signer }, recovery }
}

async function jwkOf(
  root: Uint8Array<ArrayBuffer>,
  sealed: string,
  label: 'private' | 'sign',
  pub: string,
): Promise<JsonWebKey> {
  const text = await openText(root, sealed, label, pub)
  let priv: unknown
  try {
    priv = JSON.parse(text)
  } catch {
    throw new Error('pass: unreadable keyring')
  }
  if (typeof priv !== 'object' || priv === null || Array.isArray(priv))
    throw new Error('pass: unreadable keyring')
  return priv
}

export async function openedWith(keyring: Keyring, root: Uint8Array<ArrayBuffer>): Promise<Opened> {
  const priv = await jwkOf(root, keyring.private, 'private', keyring.pub)
  const sign = keyring.sign
  const signer = sign
    ? { pub: sign.pub, priv: await jwkOf(root, sign.private, 'sign', sign.pub) }
    : null
  return { root, pair: { pub: keyring.pub, priv }, signer }
}

export async function withSigner(
  keyring: Keyring,
  opened: Opened,
): Promise<{ keyring: Keyring; opened: Opened }> {
  if (opened.signer) return { keyring, opened }
  const signer = await newSigner()
  return {
    keyring: { ...keyring, sign: await signSealOf(opened.root, signer), at: laterThan(keyring) },
    opened: { ...opened, signer },
  }
}

function saltOf(seal: PasswordSeal): Uint8Array<ArrayBuffer> {
  try {
    return unbase64(seal.salt)
  } catch {
    throw new WrongSecret()
  }
}

export async function openWithPassword(keyring: Keyring, password: string): Promise<Opened> {
  const asked = keyring.password
  if (asked.m > MOST_KDF_MEMORY || asked.t > MOST_KDF_PASSES) throw new KdfTooCostly()
  const params = kdfParamsIn(asked)
  if (params === null) throw new WrongSecret()
  const key = await passwordKey(password, saltOf(asked), params)
  const context = passwordContext(keyring.pub, asked.at)
  return await openedWith(keyring, await open(key, asked.sealed, 'root', ...context))
}

export async function openWithRecovery(keyring: Keyring, code: string): Promise<Opened> {
  const bytes = await recoveryKey(code)
  if (bytes === null || keyring.recovery === null) throw new WrongSecret()
  const root = await open(await recoverySealKey(bytes), keyring.recovery, 'root', 'recovery')
  return await openedWith(keyring, root)
}

export async function changePassword(
  keyring: Keyring,
  opened: Opened,
  password: string,
  params: KdfParams = PASSWORD_KDF,
): Promise<Keyring> {
  return {
    ...keyring,
    password: await passwordSealOf(opened.root, password, params, keyring.pub),
    at: laterThan(keyring),
  }
}

export async function newRecovery(
  keyring: Keyring,
  opened: Opened,
): Promise<{ keyring: Keyring; recovery: string }> {
  const { sealed, recovery } = await recoverySealOf(opened.root)
  return { keyring: { ...keyring, recovery: sealed, at: laterThan(keyring) }, recovery }
}

function parsed(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`pass: unreadable ${what}`)
  }
}

export async function sealVault(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  meta: VaultMeta,
): Promise<string> {
  return await seal(vaultKey, JSON.stringify(meta), 'vault', vaultId)
}

export async function openVault(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  sealed: string,
): Promise<VaultMeta> {
  const meta = vaultMetaIn(parsed(await openText(vaultKey, sealed, 'vault', vaultId), 'vault'))
  if (meta === null) throw new Error('pass: unreadable vault')
  return meta
}

export async function wrapVaultKey(
  vaultKey: Uint8Array<ArrayBuffer>,
  pub: string,
  vaultId: string,
): Promise<string> {
  return await wrapTo(vaultKey, pub, 'vault-key', vaultId)
}

export async function unwrapVaultKey(
  wrapped: string,
  pair: Pair,
  vaultId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return await unwrapWith(wrapped, pair, 'vault-key', vaultId)
}

function itemContext(vaultId: string, itemId: string, at: Sealing): string[] {
  return [vaultId, itemId, String(at.keyVersion), String(at.rev)]
}

function revOfHead(bytes: Uint8Array<ArrayBuffer>): number | null {
  if (bytes.length < HEAD || !MARK.every((one, at) => bytes[at] === one)) return null
  return new DataView(bytes.buffer, bytes.byteOffset, HEAD).getUint32(4)
}

function bodyBytes(body: string): Uint8Array<ArrayBuffer> {
  try {
    return unbase64(body)
  } catch {
    throw new WrongSecret()
  }
}

export function sealedRevOf(body: string): number | null {
  try {
    return revOfHead(unbase64(body))
  } catch {
    return null
  }
}

function textOf(bytes: Uint8Array<ArrayBuffer>): string {
  try {
    return fromUtf8(bytes)
  } catch {
    throw new WrongSecret()
  }
}

function envelopeFrom(text: string): Envelope {
  const envelope = envelopeIn(parsed(text, 'item'))
  if (envelope === null) throw new Error('pass: unreadable item')
  return envelope
}

export async function sealItemKey(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  itemKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return await seal(vaultKey, itemKey, 'item-key', vaultId, itemId)
}

export async function openItemKey(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  key: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const itemKey = await open(vaultKey, key, 'item-key', vaultId, itemId)
  if (itemKey.length !== 32) throw new Error('pass: unreadable item')
  return itemKey
}

export async function sealItemBody(
  itemKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  envelope: Envelope,
  at: Sealing,
): Promise<string> {
  if (!Number.isSafeInteger(at.rev) || at.rev < 0 || at.rev > 0xffffffff) {
    throw new Error('pass: a sealed revision is a whole number below 2^32')
  }
  const head = new Uint8Array(HEAD)
  head.set(MARK)
  new DataView(head.buffer).setUint32(4, at.rev)
  const context = itemContext(vaultId, itemId, at)
  const sealed = await sealBytes(itemKey, JSON.stringify(envelope), 'item', ...context)
  return base64(joined(head, sealed))
}

export async function openItemBody(
  itemKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  body: string,
  keyVersion: number,
): Promise<{ envelope: Envelope; rev: number | null }> {
  const bytes = bodyBytes(body)
  const rev = revOfHead(bytes)
  const opened =
    rev === null
      ? await openBytes(itemKey, bytes, 'item', vaultId, itemId)
      : await openBytes(
          itemKey,
          bytes.slice(HEAD),
          'item',
          ...itemContext(vaultId, itemId, { keyVersion, rev }),
        )
  return { envelope: envelopeFrom(textOf(opened)), rev }
}

export async function sealItem(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  envelope: Envelope,
  at: Sealing,
  itemKey: Uint8Array<ArrayBuffer> = newKey(),
): Promise<{ key: string; body: string; itemKey: Uint8Array<ArrayBuffer> }> {
  return {
    key: await sealItemKey(vaultKey, vaultId, itemId, itemKey),
    body: await sealItemBody(itemKey, vaultId, itemId, envelope, at),
    itemKey,
  }
}

export async function openItem(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  key: string,
  body: string,
  keyVersion: number,
): Promise<OpenedItem> {
  const itemKey = await openItemKey(vaultKey, vaultId, itemId, key)
  const { envelope, rev } = await openItemBody(itemKey, vaultId, itemId, body, keyVersion)
  return { envelope, itemKey, rev }
}

export async function sealVersion(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  rev: number,
  envelope: Envelope,
  itemKey: Uint8Array<ArrayBuffer>,
): Promise<{ key: string; body: string }> {
  return {
    key: await sealItemKey(vaultKey, vaultId, itemId, itemKey),
    body: await seal(itemKey, JSON.stringify(envelope), 'version', vaultId, itemId, String(rev)),
  }
}

export async function openVersion(
  vaultKey: Uint8Array<ArrayBuffer>,
  vaultId: string,
  itemId: string,
  rev: number,
  key: string,
  body: string,
): Promise<{ envelope: Envelope; itemKey: Uint8Array<ArrayBuffer> }> {
  const itemKey = await openItemKey(vaultKey, vaultId, itemId, key)
  try {
    const text = await openText(itemKey, body, 'version', vaultId, itemId, String(rev))
    return { envelope: envelopeFrom(text), itemKey }
  } catch (error) {
    if (!(error instanceof WrongSecret) || sealedRevOf(body) !== null) throw error
    const text = textOf(await openBytes(itemKey, bodyBytes(body), 'item', vaultId, itemId))
    return { envelope: envelopeFrom(text), itemKey }
  }
}
