import type { Hashed } from './protection.svelte'
import { type Cost, scrypt } from './scrypt'

const COST: Cost = { n: 32768, r: 8, p: 1 }
const LENGTH = 32

const encoder = new TextEncoder()

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function unbase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function derive(password: string, salt: Uint8Array<ArrayBuffer>, cost: Cost) {
  return scrypt(encoder.encode(password.normalize('NFC')), salt, cost, LENGTH)
}

export async function hashPassword(password: string): Promise<Hashed> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { ...COST, salt: base64(salt), hash: base64(await derive(password, salt, COST)) }
}

export async function matches(password: string, kept: Hashed): Promise<boolean> {
  const wanted = unbase64(kept.hash)
  const got = await derive(password, unbase64(kept.salt), kept)
  let differs = wanted.length ^ got.length
  for (let i = 0; i < wanted.length; i++) differs |= (wanted[i] ?? 0) ^ (got[i] ?? 0)
  return differs === 0
}
