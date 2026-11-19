import { providePort } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'
import {
  claimName,
  fileNameFor,
  localSources,
  remotePath,
  reveal,
  SHEET_POLICY,
  showLabel,
  stemOf,
  swapSources,
  zipOf,
} from '../src/api'

const reached: string[] = []
vi.mock('../../platform/src/api', async (importOriginal) => ({ ...(await importOriginal<object>()), isDesktop: true }))
vi.mock('../../web-backend/src/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  diskPathOf: (path: string) => {
    reached.push(`disk ${path}`)
    return Promise.resolve(path)
  },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: (path: string) => {
    reached.push(`system ${path}`)
    return Promise.resolve()
  },
}))

describe('names', () => {
  test('a file name takes the extension in place of the note ending', () => {
    expect(stemOf('Plan.md')).toBe('Plan')
    expect(stemOf('v1.2 notes')).toBe('v1.2 notes')
    expect(fileNameFor('Plan.md', 'pdf')).toBe('Plan.pdf')
  })
  test('a claimed name is numbered past the ones already taken and then taken itself', () => {
    const taken = new Set(['a.png'])
    expect(claimName('a.png', taken)).toBe('a 2.png')
    expect(claimName('a.png', taken)).toBe('a 3.png')
    expect(taken.has('a 3.png')).toBe(true)
  })
})
describe('the writers', () => {
  test('find the pictures a page reads from disk and leave the web ones alone', () => {
    expect(
      localSources('<img src="a.png"><img src="https://orden.so/b.png"><img src="data:image/png;base64,AA">'),
    ).toEqual(['a.png'])
  })
  test('swap the pictures asked for and leave the page alone when none are', () => {
    const page = '<img src="a.png"><img src="b.png">'
    expect(swapSources(page, new Map([['a.png', 'data:x']]))).toBe('<img src="data:x"><img src="b.png">')
    expect(swapSources(page, new Map())).toBe(page)
  })
  test('let a printed sheet show the app assets and run no script', () => {
    expect(SHEET_POLICY).toContain('img-src * data: blob: asset:')
    expect(SHEET_POLICY).toContain("script-src 'none'")
  })
  test('pack a zip file holding every entry', async () => {
    const bytes = await zipOf([
      { path: 'note.md', body: '# Hello' },
      { path: 'a.png', body: new Uint8Array([1, 2, 3]) },
    ])
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK')
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('note.md')
    expect(text).toContain('a.png')
  })
})
test('showing a file where it sits names Finder on a Mac unless the explorer port offers to show it', () => {
  expect(showLabel('macos')).toBe('Show in Finder')
  const stop = providePort('explorer.show', {
    offered: () => true,
    show: () => Promise.resolve(true),
  })
  expect(showLabel('macos')).toBe('Show in folder')
  expect(showLabel('linux')).toBe('Show in folder')
  stop()
  expect(showLabel('macos')).toBe('Show in Finder')
})
const ELSEWHERE = [
  '\\\\attacker.example\\share\\report.md',
  '//attacker.example/share/report.md',
  '\\/attacker.example/share',
  '/\\attacker.example\\share',
  '  \\\\attacker.example\\share  ',
  '\\\\?\\UNC\\attacker.example\\share\\a.md',
  '\\\\.\\UNC\\attacker.example\\share',
  '//?/UNC/attacker.example/share',
  '\\\\.\\pipe\\spool',
  '\\??\\UNC\\attacker.example\\share',
  'file://attacker.example/share/a.md',
  'FILE://attacker.example/share/a.md',
  'file:////attacker.example/share/a.md',
  'file:///%5C%5Cattacker.example/share',
  'file://localhost//attacker.example/share',
  'file:\\\\attacker.example\\share',
]
const HERE = [
  'C:\\Users\\me\\a.md',
  'C:/Users/me/a.md',
  '\\\\?\\C:\\Users\\me\\a.md',
  '/Users/me/a.md',
  '~/notes/a.md',
  'notes/a.md',
  'file:///C:/Users/me/a.md',
  'file:///home/me/a.md',
  'file://localhost/home/me/a.md',
]
describe('a path on another host', () => {
  test('is told apart from a path on this machine on every system', () => {
    expect(ELSEWHERE.filter((path) => !remotePath(path))).toEqual([])
    expect(HERE.filter((path) => remotePath(path))).toEqual([])
  })
  test('is never shown, by the system or the Orden explorer, so no press connects to its host', async () => {
    const stop = providePort('explorer.show', {
      offered: () => true,
      show: (path) => {
        reached.push(`explorer ${path}`)
        return Promise.resolve(false)
      },
    })
    for (const path of ELSEWHERE) {
      await reveal(path)
      await reveal(path, { system: true })
    }
    expect(reached).toEqual([])
    await reveal('C:\\Users\\me\\a.md', { system: true })
    await reveal('/Users/me/a.md')
    stop()
    expect(reached).toEqual([
      'disk C:\\Users\\me\\a.md',
      'system C:\\Users\\me\\a.md',
      'disk /Users/me/a.md',
      'explorer /Users/me/a.md',
      'system /Users/me/a.md',
    ])
  })
})
