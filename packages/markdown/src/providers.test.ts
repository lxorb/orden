import { describe, expect, test } from 'vitest'
import { providers, webEmbed } from './providers'
import { webCard } from './web-embed'

const frame = (address: string) => webEmbed(address)?.frame ?? null
const named = (address: string) => webEmbed(address)?.provider.id ?? null

describe('the addresses a note can show rather than link to', () => {
  test('a YouTube video, however it was written', () => {
    const wanted = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    for (const address of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(frame(address), address).toBe(wanted)
    }
  })

  test('and never youtube.com itself, which sets a cookie to be watched', () => {
    expect(frame('https://youtu.be/dQw4w9WgXcQ')).toContain('youtube-nocookie.com')
  })

  test('a timestamp is where it starts', () => {
    expect(frame('https://youtu.be/abc?t=90')).toBe(
      'https://www.youtube-nocookie.com/embed/abc?start=90',
    )
    expect(frame('https://youtu.be/abc?t=1m30s')).toContain('start=90')
    expect(frame('https://youtu.be/abc?t=1h')).toContain('start=3600')
  })

  test('a page of a provider that is not a thing to show is a link', () => {
    expect(webEmbed('https://www.youtube.com/@somebody')).toBe(null)
    expect(webEmbed('https://www.youtube.com/')).toBe(null)
    expect(webEmbed('https://vimeo.com/somebody/likes')).toBe(null)
    expect(webEmbed('https://x.com/somebody')).toBe(null)
    expect(webEmbed('https://open.spotify.com/user/x')).toBe(null)
  })

  test('everything else on the web is a link like any other', () => {
    expect(webEmbed('https://example.test/a')).toBe(null)
    expect(webEmbed('https://gist.github.com/a/b')).toBe(null)
    expect(webEmbed('shot.png')).toBe(null)
    expect(webEmbed('')).toBe(null)
  })

  test('and so is anything not asked for over https', () => {
    expect(webEmbed('http://www.youtube.com/watch?v=abc')).toBe(null)
    expect(webEmbed('javascript:alert(1)')).toBe(null)
  })

  test('the other rows', () => {
    expect(frame('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456')
    expect(frame('https://x.com/nib/status/1234567890')).toBe(
      'https://platform.twitter.com/embed/Tweet.html?id=1234567890',
    )
    expect(frame('https://twitter.com/nib/status/1234567890')).toContain('id=1234567890')
    expect(frame('https://open.spotify.com/track/abc123')).toBe(
      'https://open.spotify.com/embed/track/abc123',
    )
    expect(frame('https://open.spotify.com/intl-de/album/abc123')).toBe(
      'https://open.spotify.com/embed/album/abc123',
    )
    expect(frame('https://soundcloud.com/artist/track')).toContain('w.soundcloud.com/player/?url=')
    expect(frame('https://www.figma.com/design/abc/Name')).toContain(
      'figma.com/embed?embed_host=nib',
    )
    expect(frame('https://codepen.io/someone/pen/abcDEF')).toBe(
      'https://codepen.io/someone/embed/abcDEF?default-tab=result',
    )
    expect(frame('https://www.loom.com/share/abc123')).toBe('https://www.loom.com/embed/abc123')
    expect(frame('https://www.google.com/maps?q=Bern')).toContain('maps?q=Bern&output=embed')
    expect(frame('https://www.google.com/maps/place/Bern/@46.9,7.4,12z')).toContain('q=Bern')
    expect(frame('https://www.google.com/maps/@46.9,7.4,12z')).toContain('q=46.9%2C7.4')
    expect(named('https://maps.app.goo.gl/abc')).toBe(null)
  })

  test('nothing a link wrote reaches a frame address unchecked', () => {
    // A piece of somebody else's path carrying a `?`, a `/` or a `#` would be a
    // frame pointed somewhere the table never named.
    expect(frame('https://youtu.be/abc?x=1/../../evil')).toBe(
      'https://www.youtube-nocookie.com/embed/abc',
    )
    expect(webEmbed('https://www.loom.com/share/abc%2f..%2fevil')).toBe(null)
    expect(webEmbed('https://codepen.io/a/pen/b?c=d#e')).not.toBe(null)
    expect(frame('https://codepen.io/a/pen/b?c=d#e')).toBe(
      'https://codepen.io/a/embed/b?default-tab=result',
    )
  })

  test('every row asks for a sandbox, and none for more than it needs', () => {
    for (const provider of providers()) {
      expect(provider.sandbox, provider.id).toContain('allow-scripts')
      expect(provider.sandbox, provider.id).not.toContain('allow-top-navigation')
      expect(provider.sandbox, provider.id).not.toContain('allow-downloads')
      expect(provider.sandbox, provider.id).not.toContain('allow-modals')
    }
  })

  test('and every row has a name, a mark and a shape', () => {
    const rows = providers()
    expect(rows.length).toBeGreaterThan(5)
    for (const provider of rows) {
      expect(provider.name, provider.id).not.toBe('')
      expect(['play', 'open'], provider.id).toContain(provider.mark)
      expect(provider.shape === 'video' || provider.shape > 0, provider.id).toBe(true)
    }
    expect(new Set(rows.map((one) => one.id)).size).toBe(rows.length)
  })
})

describe('the card an address is shown as', () => {
  test('says whose page it is, and holds the frame without loading it', () => {
    const card = webCard('https://youtu.be/dQw4w9WgXcQ')
    expect(card).toContain('class="embed-web embed-wide"')
    expect(card).toContain('data-provider="youtube"')
    expect(card).toContain('data-frame="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(card).toContain('data-sandbox="allow-scripts allow-same-origin allow-presentation"')
    expect(card).toContain('YouTube')
    // Nothing that a browser would fetch on its own.
    expect(card).not.toContain('<iframe')
    expect(card).not.toContain('src=')
  })

  test('is a link, so a page with no script still goes somewhere', () => {
    const card = webCard('https://youtu.be/abc') ?? ''
    expect(card).toContain('href="https://youtu.be/abc"')
    expect(card).toContain('rel="noopener noreferrer nofollow"')
    expect(card).toContain('referrerpolicy="no-referrer"')
  })

  test('takes the room the frame will take, so nothing moves when it loads', () => {
    expect(webCard('https://x.com/a/status/1')).toContain('--embed-height: 520px')
    expect(webCard('https://youtu.be/abc')).toContain('embed-wide')
  })

  test('and nothing else gets one', () => {
    expect(webCard('https://example.test/a')).toBe(null)
    expect(webCard('shot.png')).toBe(null)
  })
})
