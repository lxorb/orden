import { describe, expect, test } from 'vitest'
import type { DomainStatus } from './api'
import { domainNotice, keepAsking } from './domain-status'

const status = (state: DomainStatus['state'], detail: string | null = null): DomainStatus => ({
  domain: state === 'none' ? null : 'notes.example.com',
  state,
  detail,
  dns: [],
})

describe('what the pane says about a domain', () => {
  test('nothing while there is no domain', () => {
    expect(domainNotice(status('none'))).toBeNull()
  })

  test('that it is waiting, quietly, while the record is on its way', () => {
    const notice = domainNotice(status('pending'))
    expect(notice?.tone).toBe('muted')
    expect(notice?.text).toBe('Waiting for the record to show up.')
  })

  test("passes on what Cloudflare is waiting for", () => {
    const notice = domainNotice(status('pending', 'custom hostname does not CNAME to this zone.'))
    expect(notice?.detail).toBe('custom hostname does not CNAME to this zone.')
  })

  test('that it works, once it does', () => {
    const notice = domainNotice(status('active'))
    expect(notice?.tone).toBe('ok')
    expect(notice?.text).toBe('Certificate issued.')
  })

  test('what went wrong, in red', () => {
    const notice = domainNotice(status('error', 'the domain no longer points here'))
    expect(notice?.tone).toBe('bad')
    expect(notice?.detail).toBe('the domain no longer points here')
  })

  test('that this server cannot do it yet', () => {
    const notice = domainNotice(status('unconfigured'))
    expect(notice?.tone).toBe('muted')
    expect(notice?.text).toBe('This server does not hand out certificates yet.')
  })
})

describe('whether to ask again', () => {
  test('while the record is on its way', () => {
    expect(keepAsking(status('pending'))).toBe(true)
  })

  test('after trouble, which the owner may be fixing', () => {
    expect(keepAsking(status('error', 'the domain no longer points here'))).toBe(true)
  })

  test('not once it works', () => {
    expect(keepAsking(status('active'))).toBe(false)
  })

  test('not when there is nothing to ask about', () => {
    expect(keepAsking(status('none'))).toBe(false)
    expect(keepAsking(status('unconfigured'))).toBe(false)
    expect(keepAsking(null)).toBe(false)
  })
})
