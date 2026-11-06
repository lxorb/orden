import { describe, expect, test } from 'vitest'
import manifest from '../../../even.app.json'

describe('the manifest a build is packed from', () => {
  const ALLOWED = ['g2-microphone', 'phone-microphone', 'album', 'location', 'network', 'camera']

  test('names every permission the way the CLI names it', () => {
    for (const one of manifest.permissions) {
      expect(ALLOWED, one.name).toContain(one.name)
    }
  })

  test('says what each permission is for, in a sentence a reader is shown', () => {
    for (const one of manifest.permissions) {
      expect(one.desc.length, one.name).toBeGreaterThan(10)
      expect(one.desc.endsWith('.'), one.name).toBe(true)
    }
  })

  test('asks for both microphones, because it listens through both', () => {
    const names = manifest.permissions.map((one) => one.name)

    expect(names).toContain('g2-microphone')
    expect(names).toContain('phone-microphone')
  })

  test('whitelists every origin the plugin talks to, and nothing else', () => {
    const network = manifest.permissions.find((one) => one.name === 'network')

    expect(network?.whitelist).toEqual(['https://orden.so'])
    for (const origin of network?.whitelist ?? []) {
      expect(origin, origin).toMatch(/^https:\/\/[a-z0-9.-]+$/)
    }
  })

  test('only the network permission carries a whitelist', () => {
    for (const one of manifest.permissions) {
      if (one.name === 'network') continue
      expect('whitelist' in one, one.name).toBe(false)
    }
  })

  test('keeps the nine keys the CLI schema takes, and no others', () => {
    expect(Object.keys(manifest).sort()).toEqual([
      'edition',
      'entrypoint',
      'min_app_version',
      'min_sdk_version',
      'name',
      'package_id',
      'permissions',
      'supported_languages',
      'version',
    ])
  })

  test('has a package id of the shape the CLI demands', () => {
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  })

  test('is the one edition there is', () => {
    expect(manifest.edition).toBe('202601')
  })

  test('has a name short enough, and one the portal will not read as impersonation', () => {
    expect(manifest.name.length).toBeLessThanOrEqual(20)
    expect(manifest.name.toLowerCase()).not.toContain('even')
  })

  test('has a plain three part version, which is what a bump publishes', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('points at the page the plugin is, not at the editor', () => {
    expect(manifest.entrypoint).toBe('even.html')
  })

  test('lists only languages the platform has a code for', () => {
    const CODES = ['en', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko']
    for (const one of manifest.supported_languages) expect(CODES, one).toContain(one)
  })
})
