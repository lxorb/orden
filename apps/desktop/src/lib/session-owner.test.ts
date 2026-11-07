import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const { forgetSessionOwner, sessionOwner } = await import('./session-owner')

const ana = { id: 'u_ana' }

beforeEach(() => forgetSessionOwner())

describe('whose records a device opens', () => {
  test('the account it was last, while the session is there and the user not yet known', () => {
    expect(sessionOwner({ token: 't', user: ana, guest: null })).toBe('u_ana')
    expect(sessionOwner({ token: 't', user: null, guest: null })).toBe('u_ana')
  })

  test('nobody once signed out, a guest, or a session never known', () => {
    expect(sessionOwner({ token: 't', user: null, guest: null })).toBeNull()
    sessionOwner({ token: 't', user: ana, guest: null })
    expect(sessionOwner({ token: null, user: null, guest: null })).toBeNull()
    expect(sessionOwner({ token: 't', user: null, guest: { name: 'Guest' } })).toBeNull()
    forgetSessionOwner()
    expect(sessionOwner({ token: 't', user: null, guest: null })).toBeNull()
  })

  test('another account signing in is its own at once', () => {
    sessionOwner({ token: 't', user: ana, guest: null })
    expect(sessionOwner({ token: 'u', user: { id: 'u_bo' }, guest: null })).toBe('u_bo')
    expect(sessionOwner({ token: 'u', user: null, guest: null })).toBe('u_bo')
  })
})
