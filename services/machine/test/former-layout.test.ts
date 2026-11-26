import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', 'former-layout.sh')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function put(root: string, path: string, text: string, mode = 0o644): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  chmodSync(file, mode)
}
const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8')
const has = (root: string, path: string): boolean => existsSync(join(root, path))
function formerServer(): string {
  const root = mkdtempSync(join(tmpdir(), 'orden-former-'))
  roots.push(root)
  put(root, 'opt/nibd/nibd.cjs', 'old program')
  put(root, 'opt/nibd/hold.cjs', 'old holder')
  put(root, 'opt/nibd/pty', '1.0.0')
  put(root, 'opt/nibd/bundle', 'a'.repeat(64))
  put(root, 'opt/nibd/node_modules/node-pty/index.js', 'module.exports = {}')
  put(root, 'etc/nibd/env', 'NIBD_SECRET=s3cret\nTZ=Europe/Zurich\n', 0o600)
  put(root, 'etc/nibd/ssh_key', 'ssh-ed25519 AAAA owner\n', 0o600)
  put(root, 'etc/nib/machine', 'NIB_ORIGIN=https://orden.so\n')
  put(root, 'var/lib/nibd/saves/s_one.json', 'a saved screen')
  mkdirSync(join(root, 'var/lib/nibd/holds'), { recursive: true })
  put(root, 'etc/systemd/system/nibd.service', 'old unit')
  put(root, 'etc/systemd/system/nib-agents.service', 'old unit')
  put(root, 'etc/profile.d/nib.sh', 'export BROWSER=nib-open')
  for (const name of ['nib-update', 'nib-agents', 'nib-open']) put(root, `usr/local/bin/${name}`, 'old', 0o755)
  symlinkSync('nib-open', join(root, 'usr/local/bin/xdg-open'))
  put(root, 'sys/fs/cgroup/nibd/s_one/cgroup.procs', '4242\n')
  const shim = (name: string, body: string) => put(root, `shims/${name}`, `#!/bin/bash\n${body}\n`, 0o755)
  shim(
    'systemctl',
    `echo "systemctl $*" >>"${root}/calls"\ncase "$*" in *is-active*orden-former-layout*) exit 3 ;; esac\nexit 0`,
  )
  shim('systemd-run', `echo "systemd-run $*" >>"${root}/calls"`)
  shim('curl', `[ -e "${root}/answers" ]`)
  shim('sleep', 'exit 0')
  return root
}
function run(root: string, step: string): { status: number | null; said: string } {
  const ran = spawnSync('bash', [SCRIPT, step], {
    env: { PATH: `${join(root, 'shims')}:${process.env.PATH ?? ''}`, ORDEN_FORMER_ROOT: root },
    encoding: 'utf8',
  })
  return { status: ran.status, said: ran.stderr }
}
function installed(root: string): void {
  put(root, 'opt/ordend/ordend.cjs', 'new program')
  put(root, 'opt/ordend/hold.cjs', 'new holder')
  put(root, 'etc/systemd/system/ordend.service', 'new unit')
  put(root, 'etc/systemd/system/orden-agents.service', 'new unit')
  put(root, 'etc/profile.d/orden.sh', 'export BROWSER=orden-open')
  for (const name of ['orden-update', 'orden-agents', 'orden-open']) put(root, `usr/local/bin/${name}`, 'new', 0o755)
  rmSync(join(root, 'usr/local/bin/xdg-open'))
  symlinkSync('orden-open', join(root, 'usr/local/bin/xdg-open'))
  mkdirSync(join(root, 'var/lib/ordend'), { recursive: true })
}
const calls = (root: string): string[] => (has(root, 'calls') ? read(root, 'calls').trim().split('\n') : [])
const OLD = [
  'opt/nibd',
  'etc/nibd',
  'etc/nib',
  'var/lib/nibd',
  'etc/systemd/system/nibd.service',
  'etc/systemd/system/nib-agents.service',
  'etc/profile.d/nib.sh',
  'usr/local/bin/nib-update',
  'usr/local/bin/nib-agents',
  'usr/local/bin/nib-open',
]
const linux = test.runIf(process.platform === 'linux')
linux('a server from before the rename is moved whole, and the old layout goes only once the new one answers', () => {
  const root = formerServer()
  expect(run(root, 'prepare').status).toBe(0)
  expect(read(root, 'etc/ordend/env')).toBe('ORDEND_SECRET=s3cret\nTZ=Europe/Zurich\n')
  expect(statSync(join(root, 'etc/ordend/env')).mode & 0o777).toBe(0o600)
  expect(read(root, 'etc/ordend/ssh_key')).toBe('ssh-ed25519 AAAA owner\n')
  expect(read(root, 'etc/orden/machine')).toBe('ORDEN_ORIGIN=https://orden.so\n')
  expect(has(root, 'opt/ordend/node_modules/node-pty/index.js')).toBe(true)
  expect(has(root, 'opt/ordend/nibd.cjs')).toBe(false)
  for (const path of OLD) expect(has(root, path), path).toBe(true)
  expect(read(root, 'var/lib/nibd/saves/s_one.json')).toBe('a saved screen')
  expect(calls(root)).toEqual([])

  installed(root)
  expect(run(root, 'prepare').status).toBe(0)
  expect(read(root, 'opt/ordend/ordend.cjs')).toBe('new program')
  expect(run(root, 'launch').status).toBe(0)
  expect(calls(root).at(-1)).toContain('systemd-run --no-block --collect --unit=orden-former-layout')

  writeFileSync(join(root, 'answers'), '')
  const switched = run(root, 'switch')
  expect(switched.status, switched.said).toBe(0)
  expect(read(root, 'var/lib/ordend/saves/s_one.json')).toBe('a saved screen')
  expect(has(root, 'var/lib/ordend/holds')).toBe(true)
  for (const path of OLD) expect(has(root, path), path).toBe(false)
  expect(has(root, 'opt/ordend/former-layout.sh')).toBe(false)
  expect(read(root, 'opt/ordend/ordend.cjs')).toBe('new program')
  expect(read(root, 'sys/fs/cgroup/ordend/s_one/cgroup.procs')).toBe('4242\n')
  const asked = calls(root)
  const at = (call: string) => asked.indexOf(`systemctl ${call}`)
  expect(at('stop nibd.service')).toBeGreaterThan(-1)
  expect(at('enable ordend.service orden-agents.service')).toBeGreaterThan(at('stop nibd.service'))
  expect(at('start ordend.service')).toBeGreaterThan(at('enable ordend.service orden-agents.service'))
})
linux('what is already under the new names is never written over', () => {
  const root = formerServer()
  put(root, 'etc/ordend/env', 'ORDEND_SECRET=another\n', 0o600)
  const refused = run(root, 'prepare')
  expect(refused.status).toBe(1)
  expect(refused.said).toContain('is already there')
  expect(read(root, 'etc/ordend/env')).toBe('ORDEND_SECRET=another\n')
  expect(has(root, 'opt/ordend')).toBe(false)
  for (const path of OLD) expect(has(root, path), path).toBe(true)
  expect(run(root, 'prepare').said).toContain('failed here before')

  const other = formerServer()
  put(other, 'var/lib/ordend/saves/s_two.json', 'a newer screen')
  expect(run(other, 'prepare').status).toBe(1)
  expect(read(other, 'var/lib/ordend/saves/s_two.json')).toBe('a newer screen')
  expect(read(other, 'var/lib/nibd/saves/s_one.json')).toBe('a saved screen')
  expect(has(other, 'opt/ordend')).toBe(false)
})
linux('a server that does not answer from the new layout goes back to the old one, with everything it had', () => {
  const root = formerServer()
  expect(run(root, 'prepare').status).toBe(0)
  installed(root)
  const switched = run(root, 'switch')
  expect(switched.status).toBe(1)
  expect(switched.said).toContain('going back to the old layout')
  expect(read(root, 'var/lib/nibd/saves/s_one.json')).toBe('a saved screen')
  expect(read(root, 'opt/nibd/nibd.cjs')).toBe('old program')
  expect(read(root, 'etc/nibd/env')).toBe('NIBD_SECRET=s3cret\nTZ=Europe/Zurich\n')
  for (const path of OLD) expect(has(root, path), path).toBe(true)
  for (const path of [
    'opt/ordend',
    'etc/ordend',
    'etc/orden',
    'var/lib/ordend',
    'etc/systemd/system/ordend.service',
    'etc/systemd/system/orden-agents.service',
    'etc/profile.d/orden.sh',
    'usr/local/bin/orden-update',
    'usr/local/bin/orden-open',
  ]) {
    expect(has(root, path), path).toBe(false)
  }
  expect(readlinkSync(join(root, 'usr/local/bin/xdg-open'))).toBe('nib-open')
  expect(read(root, 'sys/fs/cgroup/nibd/s_one/cgroup.procs')).toBe('4242\n')
  expect(read(root, 'opt/nibd/carry-failed')).toContain('ordend did not answer from the new layout')
  const asked = calls(root)
  expect(asked).toContain('systemctl disable --now ordend.service orden-agents.service')
  expect(asked).toContain('systemctl enable nibd.service nib-agents.service')
  expect(asked.at(-1)).toBe('systemctl start --no-block nibd.service')
  expect(run(root, 'prepare').status).toBe(1)
  expect(has(root, 'opt/ordend')).toBe(false)
})
linux('a server that kept names of its own under the new ones gets them back when the move fails', () => {
  const root = formerServer()
  put(root, 'usr/local/bin/orden-open', 'the one from before', 0o755)
  rmSync(join(root, 'usr/local/bin/nib-open'))
  symlinkSync('orden-open', join(root, 'usr/local/bin/nib-open'))
  expect(run(root, 'prepare').status).toBe(0)
  installed(root)
  expect(run(root, 'switch').status).toBe(1)
  expect(read(root, 'usr/local/bin/orden-open')).toBe('the one from before')
  expect(readlinkSync(join(root, 'usr/local/bin/xdg-open'))).toBe('nib-open')
})
