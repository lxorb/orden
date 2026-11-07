import { base64, randomBytes } from '@orden/pass/bytes'
import { openText, seal } from '@orden/pass/crypto'
import { contentIn } from '@orden/pass/envelope'
import type { Content } from '@orden/pass/types'

export const LINK_PATH = '/pass-link/'
export const OPEN_PATH = '/v1/pass-link/'

const KEY = 32
const ID = 16

export function base64url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unbase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(raw.length)
    for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at)
    return base64url(bytes) === text ? bytes : null
  } catch {
    return null
  }
}

export function newLinkId(): string {
  return base64url(randomBytes(ID))
}

export function linkUrl(origin: string, id: string, key: Uint8Array): string {
  return `${origin.replace(/\/+$/, '')}${LINK_PATH}${id}#${base64url(key)}`
}

export function linkKeyIn(hash: string): Uint8Array<ArrayBuffer> | null {
  const key = unbase64url(hash.replace(/^#/, ''))
  return key?.length === KEY ? key : null
}

export function sharedContent(content: Content): Content {
  if (content.kind !== 'login') return content
  return { ...content, passkeys: content.passkeys.map((one) => ({ ...one, privateKey: '' })) }
}

export async function sealedLink(
  key: Uint8Array<ArrayBuffer>,
  id: string,
  content: Content,
): Promise<string> {
  return await seal(key, JSON.stringify({ v: 1, content: sharedContent(content) }), 'link', id)
}

export async function openedLink(
  key: Uint8Array<ArrayBuffer>,
  id: string,
  body: string,
): Promise<Content | null> {
  try {
    const raw: unknown = JSON.parse(await openText(key, body, 'link', id))
    if (typeof raw !== 'object' || raw === null || !('content' in raw)) return null
    return contentIn(raw.content)
  } catch {
    return null
  }
}
