import { describe, expect, test } from 'vitest'
import { bridgeLike, hostFacts, pageFacts } from './facts'

/** What the plugin can say about itself when nothing else works. Every one of
 *  these has to answer on a page with no phone app behind it, because that is
 *  the page they exist for. */
describe('the names that could be a phone app', () => {
  test('finds the channel the SDK actually uses', () => {
    expect(bridgeLike(['flutter_inappwebview', 'document', 'fetch'])).toEqual([
      'flutter_inappwebview',
    ])
  })

  test('finds the other names a host might use, whatever the case', () => {
    const found = bridgeLike([
      'EvenAppBridge',
      '_listenEvenAppMessage',
      'webkit',
      'EvenHubNative',
      'myBridge',
      'setTimeout',
      'localStorage',
    ])

    expect(found).toEqual([
      'EvenAppBridge',
      'EvenHubNative',
      '_listenEvenAppMessage',
      'myBridge',
      'webkit',
    ])
  })

  test('says so rather than nothing when there are none', () => {
    expect(bridgeLike(['setTimeout', 'fetch'])).toEqual([])
  })
})

describe('what is on the page', () => {
  test('reports the channel and the handler apart', () => {
    // The handler is the thing that matters: the SDK reads
    // `flutter_inappwebview.callHandler` and nothing else, so an object with no
    // handler on it is a channel that cannot carry anything.
    const facts = hostFacts({ flutter_inappwebview: { callHandler: () => undefined } })

    expect(facts).toContainEqual({ name: 'flutter_inappwebview', value: 'object' })
    expect(facts).toContainEqual({ name: '.callHandler', value: 'function' })
  })

  test('tells a channel with no handler from no channel at all', () => {
    const half = hostFacts({ flutter_inappwebview: {} })
    expect(half).toContainEqual({ name: 'flutter_inappwebview', value: 'object' })
    expect(half).toContainEqual({ name: '.callHandler', value: 'undefined' })

    const none = hostFacts({})
    expect(none).toContainEqual({ name: 'flutter_inappwebview', value: 'undefined' })
    expect(none).toContainEqual({ name: '.callHandler', value: 'undefined' })
  })

  test('answers about a page with nothing on it rather than throwing', () => {
    expect(() => hostFacts({})).not.toThrow()
    expect(hostFacts({}).map((fact) => fact.name)).toEqual([
      'flutter_inappwebview',
      '.callHandler',
      '_listenEvenAppMessage',
      'EvenAppBridge',
      'webkit',
    ])
  })

  test('names the origin, which is what a packed page will not say', () => {
    const facts = pageFacts({
      location: { origin: 'file://', protocol: 'file:', href: 'file:///even.html' },
      navigator: { userAgent: 'a phone' },
    })

    expect(facts).toContainEqual({ name: 'origin', value: 'file://' })
    expect(facts).toContainEqual({ name: 'protocol', value: 'file:' })
    expect(facts).toContainEqual({ name: 'agent', value: 'a phone' })
  })

  test('says (none) for an opaque origin rather than leaving it blank', () => {
    // A page served from a custom scheme can report an empty origin, and an
    // empty line in the view is a line nobody can act on.
    const facts = pageFacts({ location: { origin: '', protocol: 'null:', href: '' } })

    expect(facts).toContainEqual({ name: 'origin', value: '(none)' })
  })

  test('answers even with no location or navigator at all', () => {
    expect(() => pageFacts({})).not.toThrow()
  })
})
