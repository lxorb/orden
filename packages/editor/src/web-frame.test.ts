import { providers } from '@orden/markdown/providers'
import { describe, expect, test } from 'vitest'
import {
  FRAME_REFERRER,
  frameHeight,
  framePermissions,
  frameSandbox,
  framedPage,
  htmlFrameDocument,
} from './web-frame'

describe('what a card may actually have', () => {
  test('every provider gets the sandbox its row asked for', () => {
    for (const provider of providers()) {
      expect(frameSandbox(provider.sandbox), provider.id).toBe(provider.sandbox)
      expect(framePermissions(provider.allow), provider.id).toBe(provider.allow ?? '')
    }
  })

  test('and nothing a card asked for beyond the list', () => {
    expect(frameSandbox('allow-scripts allow-top-navigation allow-modals allow-downloads')).toBe(
      'allow-scripts',
    )
    expect(frameSandbox('allow-top-navigation-by-user-activation')).toBe('')
    expect(framePermissions('camera; microphone; geolocation; fullscreen')).toBe('fullscreen')
    expect(framePermissions('payment')).toBe('')
  })

  test('an empty sandbox is a sandbox, not a missing one', () => {
    expect(frameSandbox(undefined)).toBe('')
    expect(frameSandbox('nonsense')).toBe('')
  })
})

describe('the referrer a frame sends', () => {
  test('is the origin, because no referrer at all is a video that will not play', () => {
    expect(FRAME_REFERRER).toBe('origin')
  })
})

describe('the document a block of the note’s own HTML runs in', () => {
  const SCRIPT = 'window.ranTheFrameScript = true'

  test('carries the block as data, and runs nothing inline', () => {
    const made = htmlFrameDocument('<div id="dial"></div>\n<script>run()</script>', SCRIPT)
    const block = /<script type="application\/json" id="orden-block">([\s\S]*?)<\/script>/.exec(
      made,
    )?.[1]
    expect(JSON.parse(block ?? '""')).toBe('<div id="dial"></div>\n<script>run()</script>')
    const scripts = [...made.matchAll(/<script([^>]*)>/g)].map((one) => one[1]?.trim())
    expect(scripts).toEqual([
      'type="application/json" id="orden-block"',
      'type="text/plain" id="orden-frame"',
      '',
    ])
  })

  test('and the one program that says how tall it turned out', () => {
    const made = htmlFrameDocument('<p>words</p>', SCRIPT)
    expect(made).toContain('orden-html-frame')
    expect(made).toContain('postMessage')
  })

  test('which no block can end early, whatever it writes', () => {
    const made = htmlFrameDocument('</script><script>alert(1)</script><!--', SCRIPT)
    expect(made.match(/<\/script>/g)).toHaveLength(3)
    expect(made).not.toContain('alert(1)</script>')
    expect(made).not.toContain('<!--')
  })

  test('and says nothing else about the block', () => {
    const made = htmlFrameDocument('<p>words</p>', SCRIPT)
    expect(made).not.toContain('<base')
    expect(made).not.toContain('http')
  })
})

describe('how tall an interactive block may say it is', () => {
  const said = (height: unknown) => frameHeight({ nib: 'orden-html-frame', height })

  test('what it asked for, within reason', () => {
    expect(said(320)).toBe(320)
    expect(said(240.2)).toBe(241)
    expect(said(0)).toBe(40)
    expect(said(99999)).toBe(2400)
  })

  test('and nothing at all from a message that is not one of ours', () => {
    expect(frameHeight({ height: 300 })).toBe(null)
    expect(frameHeight({ nib: 'orden-run', height: 300 })).toBe(null)
    expect(said('300')).toBe(null)
    expect(said(Number.NaN)).toBe(null)
    expect(said(Number.POSITIVE_INFINITY)).toBe(null)
    expect(frameHeight(null)).toBe(null)
    expect(frameHeight('orden-html-frame')).toBe(null)
  })
})

describe('the page a card may frame', () => {
  test('one asked for over https, and only that', () => {
    expect(framedPage('https://www.youtube-nocookie.com/embed/a')).toBe(
      'https://www.youtube-nocookie.com/embed/a',
    )
    for (const address of [
      'http://x.test/a',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://x.test/a',
      'about:blank',
      '/local/page',
      '',
    ]) {
      expect(framedPage(address), address).toBe(null)
    }
  })

  test('and never one on the page’s own origin, however it is spelled', () => {
    const own = 'https://orden.so'
    for (const address of [
      'https://orden.so/',
      'https://ORDEN.so/v1/me',
      'https://orden.so:443/anything?at=1',
    ]) {
      expect(framedPage(address, own), address).toBe(null)
    }

    expect(framedPage('https://www.youtube.com/embed/a', own)).toBe(
      'https://www.youtube.com/embed/a',
    )
    expect(framedPage('https://field.orden.so/', own)).toBe('https://field.orden.so/')
  })
})
