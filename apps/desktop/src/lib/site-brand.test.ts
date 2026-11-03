import { describe, expect, test } from 'vitest'
import { siteBrand } from './icons'

/** #1082: a website with no favicon of its own wears its brand's logo, read off its
 *  address. */
describe('the brand a website belongs to', () => {
  test('is the name the site is registered under', () => {
    expect(siteBrand('https://github.com/lxorb/orden')).toBe('github')
    expect(siteBrand('https://www.youtube.com/watch?v=1')).toBe('youtube')
    expect(siteBrand('https://open.spotify.com/track/1')).toBe('spotify')
    expect(siteBrand('https://claude.ai/new')).toBe('claude')
    expect(siteBrand('https://www.linkedin.com/in/someone')).toBe('linkedin')
  })

  test('past a country s own second level', () => {
    expect(siteBrand('https://www.amazon.co.uk/')).toBe('amazon')
    expect(siteBrand('https://www.ebay.com.au/')).toBe('ebay')
  })

  /** The few whose logo is not their name. */
  test('and the logo a site goes by where that is not its name', () => {
    expect(siteBrand('https://chatgpt.com/')).toBe('openai')
    expect(siteBrand('https://obsproject.com/download')).toBe('obsstudio')
    expect(siteBrand('https://youtu.be/abc')).toBe('youtube')
    expect(siteBrand('https://code.visualstudio.com/docs')).toBe('visualstudiocode')
    expect(siteBrand('https://twitter.com/someone')).toBe('x')
  })

  test('and nothing for an address that is not a website s', () => {
    expect(siteBrand(null)).toBeNull()
    expect(siteBrand('')).toBeNull()
    expect(siteBrand('not an address')).toBeNull()
    expect(siteBrand('file:///home/me/page.html')).toBeNull()
    expect(siteBrand('http://192.168.1.10/')).toBeNull()
    expect(siteBrand('http://localhost:5173/')).toBeNull()
  })
})
