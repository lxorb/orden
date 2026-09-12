/** The account's OpenAI key: written, never read back.
 *
 *  Emil's rule, in his words: "it stays in the account, but after you set it you
 *  can't read it anymore." Everything here follows from that one sentence.
 *
 *  - **Encrypted at rest.** AES-GCM, under a key derived from a secret that lives
 *    in the Worker's environment and nowhere in this repository. The database on
 *    its own is not enough to read a key out of.
 *  - **No secret, no storing.** A missing secret refuses the write rather than
 *    falling back to plaintext. The one thing worse than no key is a key somebody
 *    believes is encrypted.
 *  - **Bound to the account.** The user's id is the HKDF `info` and the cipher's
 *    additional data, so a ciphertext copied onto another row does not decrypt.
 *    Moving the column is not a way to borrow somebody's key.
 *  - **Read answers two things.** Whether a key is set, and its last four
 *    characters. That is what the settings pane shows and the whole of what any
 *    read can ever answer.
 *  - **A second write replaces.** There is no editing a key one cannot read.
 *
 *  The only thing that ever sees the key itself is `keyFor`, and the only caller of
 *  that is the ask route in this same folder, on its way to api.openai.com. */

import type { Env } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** How much of the key the settings pane may show. Four characters say which key
 *  it is to the person who made it and nothing at all to anybody else. */
const TAIL = 4

/** What a key may be. The shortest OpenAI has ever issued is around fifty
 *  characters and the format has changed twice, so this is a bound rather than a
 *  pattern: a shape written down here would refuse tomorrow's key. */
const SHORTEST = 20
const LONGEST = 200

/** The HKDF salt. A constant rather than a stored random one: the secret is the
 *  secret, and the salt's job here is only to keep this derivation from colliding
 *  with any other use somebody makes of the same secret later. */
const SALT = 'nib/openai-key/v1'

/** What every read answers with, and the whole of it. */
export interface KeyState {
  set: boolean
  /** The last four characters, or empty when no key is set. */
  tail: string
}

/** What is stored, as one string: a version, the nonce, the ciphertext.
 *
 *  Versioned because a scheme is a thing that gets replaced, and a row that cannot
 *  say which one it was written under is a row nobody can migrate. */
const VERSION = '1'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return btoa(out)
}

function bytes(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
  return out
}

/** The key this account's key is encrypted under, derived rather than stored.
 *
 *  HKDF over the environment's secret with the account's id as `info`, so every
 *  account has a different one and none of them is ever written down. */
async function under(secret: string, userId: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ])

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      info: encoder.encode(userId),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** One key, sealed. */
export async function sealed(
  secret: string,
  userId: string,
  key: string,
  /** Which derivation this is. A second thing encrypted under the same
   *  environment secret gets its own, which is what the salt is for; see
   *  second.ts. */
  salt: string = SALT,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const sealedBytes = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(userId) },
    await under(secret, userId, salt),
    encoder.encode(key),
  )

  return `${VERSION}.${base64(nonce)}.${base64(new Uint8Array(sealedBytes))}`
}

/** One key, opened, or null when it will not open: a secret that has been
 *  changed, a row written under a scheme this build does not know, bytes somebody
 *  edited. All of those are "there is no usable key here", which is what the ask
 *  route needs to hear. */
export async function opened(
  secret: string,
  userId: string,
  stored: string,
  salt: string = SALT,
): Promise<string | null> {
  const [version, nonce, body] = stored.split('.')
  if (version !== VERSION || !nonce || !body) return null

  try {
    const open = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(nonce), additionalData: encoder.encode(userId) },
      await under(secret, userId, salt),
      bytes(body),
    )
    return decoder.decode(open)
  } catch {
    return null
  }
}

/** Whether the environment can store a key at all. Answered separately so the
 *  route can say "the server cannot keep a key yet" rather than failing halfway
 *  through storing one. */
export function mayStore(env: Env): boolean {
  return !!env.OPENAI_KEY_SECRET
}

/** Whether a key is set on the account, and its last four characters. Reads the
 *  tail column and decrypts nothing: this is the answer to every read, and it
 *  works whether or not the secret is there. */
export async function keyState(env: Env, userId: string): Promise<KeyState> {
  const row = await env.DB.prepare('select openai_key_tail as tail from users where id = ?')
    .bind(userId)
    .first<{ tail: string | null }>()

  const tail = row?.tail ?? ''
  return { set: !!tail, tail }
}

/** The key itself, for the one caller that has to have it.
 *
 *  Not exported past this folder, and nothing in this repository logs what it
 *  answers. Null when there is no key, when the secret is missing, or when what is
 *  stored will not open. */
export async function keyFor(env: Env, userId: string): Promise<string | null> {
  const secret = env.OPENAI_KEY_SECRET
  if (!secret) return null

  const row = await env.DB.prepare('select openai_key as sealed from users where id = ?')
    .bind(userId)
    .first<{ sealed: string | null }>()

  const stored = row?.sealed
  return stored ? opened(secret, userId, stored) : null
}

/** Sets or replaces the account's key. Answers the new state, or the sentence to
 *  refuse with - which the route hands to the app as it stands, the way every
 *  other message here is. */
export async function setKey(env: Env, userId: string, given: string): Promise<KeyState | string> {
  const secret = env.OPENAI_KEY_SECRET
  // Refused rather than stored in the clear. Deliberately the first check: a
  // server that cannot encrypt has no business holding a key at all.
  if (!secret) return 'this server cannot keep a key yet'

  // A key pasted off a web page arrives with a newline, and a header with a
  // newline in it is not sent at all.
  const key = given.trim()
  if (key.length < SHORTEST || key.length > LONGEST) return 'that does not look like a key'
  if (/\s/.test(key)) return 'that does not look like a key'

  await env.DB.prepare('update users set openai_key = ?, openai_key_tail = ? where id = ?')
    .bind(await sealed(secret, userId, key), key.slice(-TAIL), userId)
    .run()

  return { set: true, tail: key.slice(-TAIL) }
}

/** Takes the key away. Both columns, so nothing is left saying a key is there. */
export async function forgetKey(env: Env, userId: string): Promise<KeyState> {
  await env.DB.prepare('update users set openai_key = null, openai_key_tail = null where id = ?')
    .bind(userId)
    .run()

  return { set: false, tail: '' }
}
