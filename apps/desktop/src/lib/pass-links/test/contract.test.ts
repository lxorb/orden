import { describe, expect, test } from 'vitest'
import { linkUrl, newLinkId } from '../src/api'
import { openedLink } from '../src/link-seal'

const newKey = () => crypto.getRandomValues(new Uint8Array(32))
describe('a secure link', () => {
  test('keeps its key after the #, so the server never sees it', () => {
    const key = newKey()
    const id = newLinkId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const url = new URL(linkUrl('https://orden.so/', id, key))
    expect(url.pathname.endsWith(id)).toBe(true)
    expect(url.search).toBe('')
    expect(url.hash.length).toBeGreaterThan(1)
  })
  test('opens nothing that was not sealed to its own key and id', async () => {
    expect(await openedLink(newKey(), newLinkId(), 'not a sealed link')).toBe(null)
  })
})
