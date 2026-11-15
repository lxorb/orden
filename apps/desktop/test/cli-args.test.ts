import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const CLI = join(import.meta.dirname, '../../cli/orden.mjs')

async function sent(
  words: string[],
  variable = 'ORDEN_ENDPOINT',
): Promise<{ verb: string; args: Record<string, unknown>; rest: string[] }> {
  let body = ''
  const server = createServer((request, response) => {
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => response.end(JSON.stringify({ ok: true, value: {} })))
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
  const { port } = server.address() as AddressInfo
  const file = join(mkdtempSync(join(tmpdir(), 'orden-cli-')), 'automation.json')
  writeFileSync(file, JSON.stringify({ port, secret: 's', pid: 1 }))

  const child = spawn(process.execPath, [CLI, ...words], {
    env: { ...process.env, [variable]: file },
  })
  await new Promise((settle) => child.on('close', settle))
  server.close()
  return JSON.parse(body) as { verb: string; args: Record<string, unknown>; rest: string[] }
}

test('a note that opens with front matter is the content, not a flag', async () => {
  const content = '---\nstatus: draft\n---\n# Plan'
  const { verb, args } = await sent(['new', 'Plan', '--content', content, '--silent'])
  expect(verb).toBe('new')
  expect(args).toEqual({ content, silent: '' })
})

test('a flag whose value is -h or --help is that value, not a request for help', async () => {
  expect(await sent(['append', 'log.md', '--content', '-h', '--yes'])).toEqual({
    verb: 'append',
    args: { content: '-h', yes: true },
    rest: ['log.md'],
  })
  expect(await sent(['append', 'log.md', '--content=--help', '--yes'])).toEqual({
    verb: 'append',
    args: { content: '--help', yes: true },
    rest: ['log.md'],
  })
  expect((await sent(['append', 'log.md', '-h'])).verb).toBe('verbs')
  expect((await sent(['--help'])).verb).toBe('verbs')
})

test('after a bare -- every word is a word, flag-shaped or not', async () => {
  expect(await sent(['search', '--', '--json', '-h'])).toEqual({
    verb: 'search',
    args: {},
    rest: ['--json', '-h'],
  })
})

test('the old NIB_ENDPOINT still finds the app for one release', async () => {
  expect((await sent(['search', 'plan'], 'NIB_ENDPOINT')).verb).toBe('search')
})

async function ran(
  words: string[],
  answer: unknown,
): Promise<{ out: string; err: string; code: number | null }> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => response.end(JSON.stringify(answer)))
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
  const { port } = server.address() as AddressInfo
  const file = join(mkdtempSync(join(tmpdir(), 'orden-cli-')), 'automation.json')
  writeFileSync(file, JSON.stringify({ port, secret: 's', pid: 1 }))

  const child = spawn(process.execPath, [CLI, ...words], {
    env: { ...process.env, ORDEN_ENDPOINT: file },
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  const code = await new Promise<number | null>((settle) => child.on('close', settle))
  server.close()
  return { out, err, code }
}

test('a verb the app answers in an agent’s shape reads as done when it is done', async () => {
  expect(
    await ran(['browser_tabs'], { status: 'ok', result: { tabs: [{ id: 't1', title: 'Docs' }] } }),
  ).toEqual({ out: 't1\tDocs\n', err: '', code: 0 })
  expect(
    await ran(['browser_tabs'], { status: 'error', code: 'failed', message: 'no browser' }),
  ).toEqual({ out: '', err: 'no browser\n', code: 1 })
  expect(
    await ran(['browser_tabs'], { status: 'needs_approval', approval: 'a1', summary: 'Approve?' }),
  ).toEqual({ out: '', err: 'Approve?\n', code: 1 })
  expect((await ran(['browser_tabs', '--json'], { status: 'ok', result: {} })).code).toBe(0)
})

test.skipIf(process.platform !== 'linux')(
  'an empty or relative XDG_CONFIG_HOME is passed over for ~/.config, as the app does',
  async () => {
    let heard = 0
    const server = createServer((request, response) => {
      heard += 1
      request.resume()
      request.on('end', () => response.end(JSON.stringify({ ok: true, value: {} })))
    })
    await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
    const { port } = server.address() as AddressInfo
    const home = mkdtempSync(join(tmpdir(), 'orden-home-'))
    mkdirSync(join(home, '.config', 'so.orden.Orden'), { recursive: true })
    writeFileSync(
      join(home, '.config', 'so.orden.Orden', 'automation.json'),
      JSON.stringify({ port, secret: 's', pid: 1 }),
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(ORDEN|NIB)_/.test(name)),
    )

    const codes: (number | null)[] = []
    for (const config of ['', 'relative/config']) {
      const child = spawn(process.execPath, [CLI, 'tags'], {
        cwd: home,
        env: { ...env, HOME: home, XDG_CONFIG_HOME: config },
      })
      codes.push(await new Promise<number | null>((settle) => child.on('close', settle)))
    }
    server.close()

    expect(codes).toEqual([0, 0])
    expect(heard).toBe(2)
  },
)
