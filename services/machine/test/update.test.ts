import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const HERE = join(import.meta.dirname, '..')
const SCRIPT = join(HERE, readdirSync(HERE).find((name) => name.endsWith('-update')) ?? 'update')

function asked(machine: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orden-update-'))
  const file = join(dir, 'machine')
  writeFileSync(file, machine)
  const log = join(dir, 'asked')
  writeFileSync(join(dir, 'curl'), `#!/bin/bash\necho "$@" >>"${log}"\nexit 1\n`)
  chmodSync(join(dir, 'curl'), 0o755)
  const script = readFileSync(SCRIPT, 'utf8').replaceAll(/\/etc\/\w+\/machine\b/g, file)
  writeFileSync(join(dir, 'update'), script)
  spawnSync('bash', [join(dir, 'update')], {
    env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
  })
  try {
    return readFileSync(log, 'utf8')
  } catch {
    return ''
  }
}

test.runIf(process.platform !== 'win32')('asks the origin its machine file names', () => {
  expect(asked('ORDEN_ORIGIN=https://orden.so\n')).toContain(
    'https://orden.so/v2/online/machine/current',
  )
})

test.runIf(process.platform !== 'win32')(
  'a machine file written before the rename still names the origin',
  () => {
    expect(asked('NIB_ORIGIN=https://orden.so\n')).toContain(
      'https://orden.so/v2/online/machine/current',
    )
  },
)
