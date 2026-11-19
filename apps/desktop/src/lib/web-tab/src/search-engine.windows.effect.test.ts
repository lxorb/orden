import { afterEach, describe, expect, test } from 'vitest'
import { searchEngine } from './search-engine.svelte'

afterEach(() => localStorage.clear())
describe('a search engine chosen in another window', () => {
  test('is used here too, and its own address is kept', () => {
    localStorage.setItem('orden:search-engine', JSON.stringify({ id: 'custom', custom: 'https://find.example/?q=%s' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'orden:search-engine' }))
    expect(searchEngine.id).toBe('custom')
    searchEngine.choose('duckduckgo')
    searchEngine.choose('custom')
    expect(searchEngine.custom).toBe('https://find.example/?q=%s')
  })
})
