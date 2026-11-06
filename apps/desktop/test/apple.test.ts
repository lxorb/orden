import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TAURI = join(HERE, '..', 'src-tauri')
const SOURCE = join(HERE, '..', 'src')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

function sentences(plist: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, key = '', words = ''] of plist.matchAll(
    /<key>(\w+)<\/key>\s*<string>([^<]*)<\/string>/g,
  )) {
    found.set(key, words)
  }

  return found
}

const granted = (plist: string) =>
  new Set([...plist.matchAll(/<key>([\w.-]+)<\/key>\s*<true\/>/g)].map((one) => one[1]))

const mac = sentences(read(TAURI, 'Info.plist'))
const phone = sentences(read(TAURI, 'Info.ios.plist'))

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

const page = sources(SOURCE).map((path) => readFileSync(path, 'utf8'))
const uses = (pattern: RegExp) => page.some((text) => pattern.test(text))

describe('the words a Mac and an iPhone ask with', () => {
  test('the page still reaches for the devices this file is about', () => {
    expect(uses(/getUserMedia\(/)).toBe(true)
    expect(uses(/webkitSpeechRecognition/)).toBe(true)
    expect(uses(/\.capture = /)).toBe(true)
  })

  test('both builds say why they want the microphone and the recogniser', () => {
    for (const plist of [mac, phone]) {
      expect(plist.get('NSMicrophoneUsageDescription')).toBeTruthy()
      expect(plist.get('NSSpeechRecognitionUsageDescription')).toBeTruthy()
    }
  })

  test('both say why they want the camera', () => {
    expect(mac.get('NSCameraUsageDescription')).toBeTruthy()
    expect(phone.get('NSCameraUsageDescription')).toBeTruthy()
  })

  test('a Mac says why printing looks at the network', () => {
    expect(mac.get('NSLocalNetworkUsageDescription')).toBeTruthy()
  })

  test('the phone does not promise a web tab it does not have', () => {
    for (const words of phone.values()) expect(words).not.toMatch(/web tab/i)
  })
})

describe('what an iPhone needs before it will show the app at all', () => {
  const plist = read(TAURI, 'Info.ios.plist')
  const config = JSON.parse(read(TAURI, 'tauri.conf.json')) as {
    bundle?: { iOS?: { minimumSystemVersion?: string } }
  }

  test('the app lives in a scene', () => {
    expect(plist).toMatch(
      /<key>UIApplicationSceneManifest<\/key>\s*<dict>\s*<key>UIApplicationSupportsMultipleScenes<\/key>\s*<true\/>/,
    )
  })

  test('its notes and its exports are somewhere the Files app shows', () => {
    for (const key of ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace']) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<true/>`))
    }
  })

  test('a picture offered to Photos has a sentence to ask with', () => {
    expect(sentences(plist).get('NSPhotoLibraryAddUsageDescription')).toBeTruthy()
  })

  test('the oldest iOS it installs on can read the page', () => {
    const [major = 0, minor = 0] = (config.bundle?.iOS?.minimumSystemVersion ?? '0')
      .split('.')
      .map(Number)
    expect(major * 100 + minor).toBeGreaterThanOrEqual(1604)
  })
})

describe('the oldest Mac it installs on', () => {
  test('can read the page', () => {
    const config = JSON.parse(read(TAURI, 'tauri.macos.conf.json')) as {
      bundle?: { macOS?: { minimumSystemVersion?: string } }
    }
    const [major = 0, minor = 0] = (config.bundle?.macOS?.minimumSystemVersion ?? '0')
      .split('.')
      .map(Number)
    expect(major * 100 + minor).toBeGreaterThanOrEqual(1303)
  })
})

describe('what the hardened runtime lets a Mac open', () => {
  const config = JSON.parse(read(TAURI, 'tauri.macos.conf.json')) as {
    bundle?: { macOS?: { entitlements?: string; hardenedRuntime?: boolean } }
  }
  const macOS = config.bundle?.macOS ?? {}

  test('the bundle is signed with entitlements', () => {
    expect(macOS.entitlements).toBe('Entitlements.plist')
  })

  test('which name the microphone and the camera', () => {
    const grants = granted(read(TAURI, macOS.entitlements ?? 'Entitlements.plist'))
    expect(grants).toContain('com.apple.security.device.audio-input')
    expect(grants).toContain('com.apple.security.device.camera')
  })

  test('and let local dictation load the runtime it downloaded, which is not signed by Orden (#1151)', () => {
    const grants = granted(read(TAURI, macOS.entitlements ?? 'Entitlements.plist'))
    expect(grants).toContain('com.apple.security.cs.disable-library-validation')
  })
})
