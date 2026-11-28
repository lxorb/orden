import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Frames, framed, PROTOCOL, SCHEMES, TO_CORE, TO_SHELL } from '../src/wire'
import type { FromShell } from '../src/wire'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), screen: {} }))
const { webviewCalls, windowCalls } = await import('../src/windows')
const RUST = readFileSync(
  join(import.meta.dirname, '..', '..', 'desktop', 'src-tauri', 'linux', 'tauri-runtime-electron', 'src', 'wire.rs'),
  'utf8',
)
const MAIN = readFileSync(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
function variants(name: string): string[] {
  const body = new RegExp(`pub enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(RUST)?.[1] ?? ''
  return [...body.matchAll(/^ {4}([A-Z]\w*)/gm)].map(([, variant = '']) => variant)
}
const camel = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1)
const kebab = (name: string): string => name.replace(/(?<!^)[A-Z]/g, (letter) => `-${letter}`).toLowerCase()
function coreSays(head: object, body = Buffer.alloc(0)): Buffer {
  return framed(head as FromShell, body)
}
describe('the wire the shell speaks', () => {
  it('is the version and the schemes of the runtime crate', () => {
    expect(/pub const PROTOCOL: u32 = (\d+);/.exec(RUST)?.[1]).toBe(String(PROTOCOL))
    expect(/pub const SCHEMES: \[&str; \d+\] = \[(.*)\];/.exec(RUST)?.[1]).toBe(
      SCHEMES.map((scheme) => `"${scheme}"`).join(', '),
    )
    expect(RUST).toContain(`pub const TO_CORE: &str = "${TO_CORE}";`)
    expect(RUST).toContain(`pub const TO_SHELL: &str = "${TO_SHELL}";`)
  })
  it('answers every window call and every webview call the runtime can make', () => {
    expect(Object.keys(windowCalls).sort()).toEqual(variants('WindowCall').map(camel).sort())
    expect(Object.keys(webviewCalls).sort()).toEqual(variants('WebviewCall').map(camel).sort())
    expect(variants('WindowCall').length).toBeGreaterThan(40)
  })
  it('hears every message of the runtime', () => {
    const ops = variants('ToShell').map(kebab)
    expect(ops).toContain('webview-create')
    for (const op of ops) expect(MAIN, op).toContain(`case '${op}':`)
  })
})
describe('frames', () => {
  const frame = coreSays({ op: 'refuse', request: 7 }, Buffer.from('body'))
  it('carry a head and a body', () => {
    expect(frame.readUInt32LE(0)).toBe(frame.length - 8 - 4)
    expect(frame.readUInt32LE(4)).toBe(4)
    expect(new Frames().take(frame)).toEqual([{ head: { op: 'refuse', request: 7 }, body: Buffer.from('body') }])
  })
  it('are put together from any split, and several can come at once', () => {
    const three = Buffer.concat([frame, coreSays({ op: 'exit', code: 0 }), frame])
    for (let cut = 1; cut < three.length; cut++) {
      const frames = new Frames()
      const heard = [...frames.take(three.subarray(0, cut)), ...frames.take(three.subarray(cut))]
      expect(heard.map((one) => one.head.op)).toEqual(['refuse', 'exit', 'refuse'])
      expect(heard[2]?.body.toString()).toBe('body')
    }
  })
  it('are read once however many pieces a large body arrives in', () => {
    const large = coreSays({ op: 'respond', request: 1, status: 200, headers: [] }, Buffer.alloc(1 << 20, 7))
    const frames = new Frames()
    const heard = []
    for (let at = 0; at < large.length; at += 1000) heard.push(...frames.take(large.subarray(at, at + 1000)))
    expect(heard).toHaveLength(1)
    expect(heard[0]?.body.length).toBe(1 << 20)
  })
  it('refuse a head that is no message', () => {
    const broken = Buffer.concat([Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('{{{')])
    expect(() => new Frames().take(broken)).toThrow()
  })
})
