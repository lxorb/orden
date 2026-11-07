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

function drawn(count: number): string[] {
  const letters = '\'"\\$`;&|<>(){}[]*?!#~%@,=^ ‘’‚‛xyé'
  let seed = 1611
  const next = () => {
    seed = (seed * 48_271) % 2_147_483_647
    return seed
  }
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + (next() % 12) }, () => letters.charAt(next() % letters.length)).join(
      '',
    ),
  )
}

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
  "a'#b'##c",
  "ends'#",
  ...drawn(200),
]

const room = mkdtempSync(join(tmpdir(), 'orden-said-'))
afterAll(() => rmSync(room, { recursive: true, force: true }))

describe('a dropped name, read back by the shell it lands in', () => {
  for (const shell of SHELLS) {
    const program = found(shell.name)
    test.skipIf(program === null)(`${shell.name} reads every name as it is`, () => {
      const root = windows ? 'C:\\t\\' : '/t/'
      const paths = NAMES.map((name) => root + name)
      const spoken = paths.map((path) => spokenPath(path, program ?? '') ?? '')
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

describe('a dropped name for a host whose shell is not known', () => {
  const root = '/t/'
  const kept = NAMES.filter((name) => spokenPath(root + name, 'ssh:box') !== null)

  test('leaves out only a name cmd or nu would act on', () => {
    expect(kept.length).toBeGreaterThan(20)
    for (const name of NAMES) if (!kept.includes(name)) expect(name).toMatch(/[&|<>^%"']/)
  })

  for (const shell of SHELLS) {
    const program = found(shell.name)
    const posix = shell.script === 'said.sh'
    test.skipIf(program === null)(
      `${shell.name} never runs a name it is given`,
      () => {
        const paths = kept.map((name) => root + name)
        const spoken = paths.map((path) => spokenPath(path, 'ssh:box') ?? '')
        const each = posix ? [spoken] : spoken.map((one) => [one])
        const scripts = each.map((lines, at) => {
          const script = join(room, `${at}-${shell.script}`)
          writeFileSync(script, shell.lines(lines))
          return script
        })
        const run = (args: string[]) =>
          spawnSync(program ?? '', [...shell.args, ...args], {
            cwd: room,
            encoding: 'utf8',
            timeout: 60_000,
          }).stdout
        const driver = join(room, 'each.ps1')
        writeFileSync(driver, 'foreach ($f in $args) { try { & $f } catch { } }\n')
        const heard =
          shell.script === 'said.ps1'
            ? [run([driver, ...scripts])]
            : scripts.map((one) => run([one]))
        if (posix)
          expect(heard[0]?.split(/\r?\n/).slice(0, paths.length), shell.name).toEqual(paths)
        expect(readdirSync(room)).not.toContain('PWNED')
      },
      120_000,
    )
  }
})
