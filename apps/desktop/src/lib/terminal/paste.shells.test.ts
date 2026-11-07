import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { spokenPath } from './paste'

const windows = process.platform === 'win32'

function found(name: string): string | null {
  const names = windows ? [`${name}.exe`] : [name]
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    for (const one of names) {
      const path = join(folder, one)
      if (folder && existsSync(path)) return path
    }
  }
  return null
}

interface Shell {
  name: string
  script: string
  lines: (spoken: string[]) => string
  args: string[]
}

const SHELLS: Shell[] = [
  ...(windows ? [] : ['bash', 'dash', 'zsh', 'ksh', 'fish', 'tcsh']).map((name) => ({
    name,
    script: 'said.sh',
    lines: (spoken: string[]) => spoken.map((one) => `printf '%s\\n' ${one}\n`).join(''),
    args: [],
  })),
  ...['pwsh', 'powershell'].map((name) => ({
    name,
    script: 'said.ps1',
    lines: (spoken: string[]) =>
      `\uFEFF[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${spoken.map((one) => `Write-Output ${one}\n`).join('')}`,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'],
  })),
  {
    name: 'nu',
    script: 'said.nu',
    lines: (spoken: string[]) => spoken.map((one) => `print ${one}\n`).join(''),
    args: [],
  },
]

const NAMES = [
  "it's here",
  "a\\';touch PWNED;#",
  "a'\\'';touch PWNED;'",
  '$(touch PWNED)',
  '`touch PWNED`',
  'a;touch PWNED;#',
  'a&touch PWNED|b',
  'a!b !! c',
  '$HOME $env:PATH',
  '%PATH% @a ,b =c',
  '{a,b} *x [y]',
  'a\\\\b\\',
  '‘quoted’ ‚low‛',
  'a"b"c',
]

const room = mkdtempSync(join(tmpdir(), 'orden-said-'))
afterAll(() => rmSync(room, { recursive: true, force: true }))

describe('a dropped name, read back by the shell it lands in', () => {
  for (const shell of SHELLS) {
    const program = found(shell.name)
    test.skipIf(program === null)(`${shell.name} reads every name as it is`, () => {
      const root = windows ? 'C:\\t\\' : '/t/'
      const paths = NAMES.map((name) => root + name)
      const spoken = paths.map((path) => spokenPath(path, program ?? ''))
      writeFileSync(join(room, shell.script), shell.lines(spoken))
      const said = spawnSync(program ?? '', [...shell.args, join(room, shell.script)], {
        cwd: room,
        encoding: 'utf8',
        timeout: 25_000,
      })
      expect(said.stdout.split(/\r?\n/).slice(0, paths.length), shell.name).toEqual(paths)
      expect(readdirSync(room)).not.toContain('PWNED')
    })
  }
})
