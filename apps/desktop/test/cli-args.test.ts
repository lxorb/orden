import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const CLI = join(import.meta.dirname, '../../cli/nib.mjs')

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
  const file = join(mkdtempSync(join(tmpdir(), 'nib-cli-')), 'automation.json')
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
