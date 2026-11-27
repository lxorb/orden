import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DAY = 86_400_000
interface Kept {
  digest: string
  files: Record<string, number>
}
let server: Server | null = null
afterEach(() => {
  server?.close()
  server = null
})
function build(files: Record<string, string>): string {
  const dist = mkdtempSync(join(tmpdir(), 'orden-web-keep-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, name)), { recursive: true })
    writeFileSync(join(dist, name), text)
  }
  return dist
}
function deployed(dist: string | null, status = 404): Promise<string> {
  server?.close()
  const serving = createServer((request, response) => {
    const path = join(dist ?? '', new URL(request.url ?? '/', 'http://x').pathname)
    if (dist === null || !existsSync(path)) {
      response.writeHead(status).end()
      return
    }
    response.writeHead(200).end(readFileSync(path))
  })
  server = serving
  return new Promise((ready) => {
    serving.listen(0, '127.0.0.1', () => ready(`http://127.0.0.1:${(serving.address() as AddressInfo).port}`))
  })
}
function keep(dist: string, origin: string, ...more: string[]): Promise<{ status: number | null; said: string }> {
  return new Promise((done) => {
    const ran = spawn('node', [join(ROOT, 'scripts', 'web-keep.mjs'), dist, origin, ...more], {
      env: { ...process.env, GITHUB_OUTPUT: join(dist, 'output') },
    })
    let said = ''
    ran.stdout.on('data', (chunk: Buffer) => (said += chunk.toString()))
    ran.stderr.on('data', (chunk: Buffer) => (said += chunk.toString()))
    ran.on('close', (status) => done({ status, said }))
  })
}
const kept = (dist: string) => JSON.parse(readFileSync(join(dist, 'assets', 'kept.json'), 'utf8')) as Kept
const output = (dist: string) => readFileSync(join(dist, 'output'), 'utf8')
const A = {
  'index.html': 'a',
  'assets/main-a.js': 'main a',
  'assets/Palette-a.js': 'palette a',
  'assets/shared.css': 'css',
}
const B = {
  'index.html': 'b',
  'assets/main-b.js': 'main b',
  'assets/Palette-b.js': 'palette b',
  'assets/shared.css': 'css',
}
describe('a page of build A after build B is deployed (#2586)', () => {
  test('still finds every piece of A, which B carries beside its own', async () => {
    const a = build(A)
    expect((await keep(a, await deployed(null))).status).toBe(0)
    expect(Object.keys(kept(a).files).sort()).toEqual(['Palette-a.js', 'main-a.js', 'shared.css'])
    const b = build(B)
    const ran = await keep(b, await deployed(a))
    expect(ran.status, ran.said).toBe(0)
    expect(readFileSync(join(b, 'assets', 'Palette-a.js'), 'utf8')).toBe('palette a')
    expect(readFileSync(join(b, 'assets', 'main-a.js'), 'utf8')).toBe('main a')
    expect(Object.keys(kept(b).files).sort()).toEqual([
      'Palette-a.js',
      'Palette-b.js',
      'main-a.js',
      'main-b.js',
      'shared.css',
    ])
    expect(kept(b).files['main-a.js']).toBe(kept(a).files['main-a.js'])
    expect(output(b)).toContain('same=false')
  })
  test('and of the build before A too, through C', async () => {
    const a = build(A)
    await keep(a, await deployed(null))
    const b = build(B)
    await keep(b, await deployed(a))
    const c = build({ 'index.html': 'c', 'assets/main-c.js': 'main c' })
    await keep(c, await deployed(b))
    expect(readFileSync(join(c, 'assets', 'Palette-a.js'), 'utf8')).toBe('palette a')
    expect(readFileSync(join(c, 'assets', 'Palette-b.js'), 'utf8')).toBe('palette b')
  })
  test('until its pieces are older than the days they are kept', async () => {
    const a = build(A)
    await keep(a, await deployed(null))
    const old = kept(a)
    old.files['main-a.js'] = Date.now() - 8 * DAY
    old.files['Palette-a.js'] = Date.now() - 6 * DAY
    writeFileSync(join(a, 'assets', 'kept.json'), JSON.stringify(old))
    const b = build(B)
    await keep(b, await deployed(a), '7')
    expect(existsSync(join(b, 'assets', 'main-a.js'))).toBe(false)
    expect(existsSync(join(b, 'assets', 'Palette-a.js'))).toBe(true)
  })
  test('the same build twice is said to be the same, and a different main is not', async () => {
    const a = build(A)
    await keep(a, await deployed(null), '7', 'main-1')
    const again = build(A)
    const origin = await deployed(a)
    await keep(again, origin, '7', 'main-1')
    expect(output(again)).toContain('same=true')
    const moved = build(A)
    await keep(moved, origin, '7', 'main-2')
    expect(output(moved)).toContain('same=false')
  })
  test('a name that would leave assets/ is not fetched', async () => {
    const a = build(A)
    await keep(a, await deployed(null))
    const told = kept(a)
    told.files['../index.html'] = Date.now()
    writeFileSync(join(a, 'assets', 'kept.json'), JSON.stringify(told))
    const b = build({ 'assets/main-b.js': 'main b' })
    await keep(b, await deployed(a))
    expect(existsSync(join(b, 'index.html'))).toBe(false)
    expect(Object.keys(kept(b).files)).not.toContain('../index.html')
  })
  test('a site that answers with an error stops the deploy, so nothing is dropped unseen', async () => {
    const b = build(B)
    const ran = await keep(b, await deployed(null, 503))
    expect(ran.status).toBe(1)
    expect(existsSync(join(b, 'assets', 'kept.json'))).toBe(false)
  })
})
describe('the workflows that deploy app.orden.so', () => {
  const read = (name: string) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8')
  test('both keep the earlier builds, and the edge builds the release once for each main', () => {
    const edge = read('web-unstable.yml')
    expect(edge).toContain(
      'node scripts/web-keep.mjs "$RUNNER_TEMP/main/apps/desktop/dist" https://app.orden.so 7 "$MAIN"',
    )
    expect(edge).toContain('key: web-release-${{ steps.live.outputs.main }}')
    expect(edge.match(/if: steps\.keep\.outputs\.same != 'true'/g)).toHaveLength(2)
    expect(read('check.yml')).toContain('node scripts/web-keep.mjs apps/desktop/dist https://app.orden.so 7')
  })
})
