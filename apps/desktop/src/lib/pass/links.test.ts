import { newKey } from '@orden/pass/crypto'
import { blank } from '@orden/pass/envelope'
import type { Login } from '@orden/pass/types'
import { describe, expect, test } from 'vitest'
import { linkIdOf } from './link-page'
import {
  base64url,
  linkKeyIn,
  linkUrl,
  newLinkId,
  openedLink,
  sealedLink,
  sharedContent,
  unbase64url,
} from './link-seal'
import { hidesPasswords, mayEdit, mayHandOn, mayManage } from './share-rules'

const passkey = {
  id: 'pk',
  rpId: 'example.com',
  rpName: 'Example',
  userName: 'ada',
  userDisplayName: 'Ada',
  userHandle: 'aA',
  credentialId: 'cA',
  privateKey: 'SECRET',
  algorithm: -7,
  counter: 0,
  created: 1,
  note: '',
}

describe('a secure link address', () => {
  test('carries an id the account accepts and the key after the #', () => {
    const key = newKey()
    const id = newLinkId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const url = new URL(linkUrl('https://orden.so/', id, key))
    expect(url.pathname).toBe(`/pass-link/${id}`)
    expect(linkIdOf(url.pathname)).toBe(id)
    expect(linkKeyIn(url.hash)).toEqual(key)
  })

  test('refuses a key that is not 32 bytes or not base64url', () => {
    expect(linkKeyIn(`#${base64url(new Uint8Array(16))}`)).toBe(null)
    expect(linkKeyIn('#not+base64/')).toBe(null)
    expect(unbase64url('A')).toBe(null)
    expect(linkIdOf('/pass-link/short')).toBe(null)
    expect(linkIdOf('/elsewhere/AAAAAAAAAAAAAAAAAAAAAA')).toBe(null)
  })

  test('round-trips every byte', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, at) => at)
    expect(unbase64url(base64url(bytes))).toEqual(bytes)
  })
})

describe('what a secure link holds', () => {
  test('is the item without its passkeys’ private keys, sealed to the link and its id', async () => {
    const login: Login = { ...blank('login'), title: 'Bank', password: 'pw', passkeys: [passkey] }
    expect((sharedContent(login) as Login).passkeys[0]?.privateKey).toBe('')
    expect(login.passkeys[0]?.privateKey).toBe('SECRET')

    const key = newKey()
    const id = newLinkId()
    const body = await sealedLink(key, id, login)
    expect(body).not.toContain('SECRET')
    const opened = (await openedLink(key, id, body)) as Login
    expect(opened.password).toBe('pw')
    expect(opened.passkeys[0]?.privateKey).toBe('')
    expect(await openedLink(key, newLinkId(), body)).toBe(null)
    expect(await openedLink(newKey(), id, body)).toBe(null)
  })
})

describe('what a role may do', () => {
  test('hides passwords only from a viewer of a vault that asks for it', () => {
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: true })).toBe(true)
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: false })).toBe(false)
    expect(hidesPasswords({ role: 'editor', hidePasswordsFromViewers: true })).toBe(false)
  })

  test('ranks viewer, editor, manager and owner', () => {
    expect(mayEdit({ role: 'viewer' })).toBe(false)
    expect(mayEdit({ role: 'editor' })).toBe(true)
    expect(mayManage({ role: 'editor' })).toBe(false)
    expect(mayManage({ role: 'manager' })).toBe(true)
    expect(mayHandOn({ role: 'manager' })).toBe(false)
    expect(mayHandOn({ role: 'owner' })).toBe(true)
  })
})
