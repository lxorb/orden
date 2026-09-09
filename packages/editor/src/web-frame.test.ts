import { providers } from '@nib/markdown/providers'
import { describe, expect, test } from 'vitest'
import { FRAME_REFERRER, framePermissions, frameSandbox, framedPage } from './web-frame'

describe('what a card may actually have', () => {
  test('every provider gets the sandbox its row asked for', () => {
    // The table is the policy, and nothing here narrows what it says. A row that
    // stopped surviving this is a row whose frame would not work.
    for (const provider of providers()) {
      expect(frameSandbox(provider.sandbox), provider.id).toBe(provider.sandbox)
      expect(framePermissions(provider.allow), provider.id).toBe(provider.allow ?? '')
    }
  })

  test('and nothing a card asked for beyond the list', () => {
    // A note can be pasted, synced or shared. One that arrived with a wider
    // sandbox written into it gets only what is allowed here.
    expect(frameSandbox('allow-scripts allow-top-navigation allow-modals allow-downloads')).toBe(
      'allow-scripts',
    )
    expect(frameSandbox('allow-top-navigation-by-user-activation')).toBe('')
    expect(framePermissions('camera; microphone; geolocation; fullscreen')).toBe('fullscreen')
    expect(framePermissions('payment')).toBe('')
  })

  test('an empty sandbox is a sandbox, not a missing one', () => {
    // `sandbox=""` takes everything away; leaving the attribute off takes nothing
    // away at all, which is why the caller always writes one.
    expect(frameSandbox(undefined)).toBe('')
    expect(frameSandbox('nonsense')).toBe('')
  })
})

describe('the referrer a frame sends', () => {
  test('is the origin, because no referrer at all is a video that will not play', () => {
    // YouTube answers an embedder that sends none with "Error 153" where the
    // video should be. The origin says which site and never which note.
    expect(FRAME_REFERRER).toBe('origin')
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
})
