import { describe, expect, test } from 'vitest'
import { loadPublishSheet, publish } from '../src/api'

describe('the module stands on its own', () => {
  test('the api loads with the sheet closed and nothing ready to publish', () => {
    expect(publish.open).toBe(false)
    expect(publish.ready).toBe(false)
    expect(typeof loadPublishSheet).toBe('function')
  })
})

describe('the form', () => {
  test('a site never published starts on a subdomain with nothing typed', () => {
    publish.fill(undefined)
    expect(publish.subdomain).toBe('')
    expect(publish.address).toBe('subdomain')
    expect(publish.hasPassword).toBe(false)
    expect(publish.rules).toEqual({ include: [], exclude: [], otherwise: 'all' })
  })

  test('a folder is included once and let go again', () => {
    publish.rule('include', 'Blog', true)
    publish.rule('include', 'Blog', true)
    expect(publish.rules.include).toEqual(['Blog'])
    publish.rule('include', 'Blog', false)
    expect(publish.rules.include).toEqual([])
  })

  test('what is not named either goes out or stays home', () => {
    publish.otherwise('none')
    expect(publish.rules.otherwise).toBe('none')
    publish.otherwise('all')
    expect(publish.rules.otherwise).toBe('all')
  })
})
