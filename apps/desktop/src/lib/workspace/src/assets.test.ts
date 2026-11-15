import { describe, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({ BASE: '' }))
vi.mock('./accounts/src/client', () => ({
  api: {},
  get BASE() {
    return api.BASE
  },
}))
vi.stubGlobal('location', { href: 'https://orden.so/s/notes' })

const { accountAddress } = await import('./assets')

describe('a picture the account keeps', () => {
  test('is named by its whole address, on the web app as on the desktop', () => {
    api.BASE = ''
    expect(accountAddress('/i/ab12.png')).toBe('https://orden.so/i/ab12.png')
    api.BASE = 'https://orden.so'
    expect(accountAddress('https://orden.so/i/ab12.png')).toBe('https://orden.so/i/ab12.png')
  })

  test('and one kept in the space is not the account’s', () => {
    api.BASE = ''
    expect(accountAddress('assets/ab12.png')).toBeNull()
    api.BASE = 'https://orden.so'
    expect(accountAddress('/i/ab12.png')).toBeNull()
    expect(accountAddress('Notes/assets/ab12.png')).toBeNull()
  })
})
