import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HERE = new URL('./', import.meta.url)
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, HERE)), 'utf8')

const SCRIPT = read('../../../scripts/capture-window.ps1')

const CALLERS = [
  '../../../apps/cli/orden.mjs',
  '../../../scripts/appearance-e2e.py',
  '../../../scripts/capture-e2e.py',
  '../../../scripts/recorder-e2e.py',
  '../../../scripts/web-freeze-probe.py',
] as const

describe('the window capture', () => {
  test('takes a pid, under both spellings', () => {
    expect(SCRIPT).toMatch(/\[Alias\('Pid'\)\]/)
    expect(SCRIPT).toMatch(/\[int\]\$ProcessId = 0/)
  })

  test('has no parameter for a name, and no way to look one up', () => {
    expect(SCRIPT).not.toMatch(/\$ProcessName/)
    expect(SCRIPT).not.toMatch(/Get-Process\s+-Name/)
  })

  test('refuses to photograph anything when no pid was given', () => {
    expect(SCRIPT).toMatch(/if \(\$ProcessId -le 0\) \{/)
    expect(SCRIPT).toContain('needs -Pid <process id>')
    expect(SCRIPT).toMatch(/exit 2/)

    expect(SCRIPT.indexOf('exit 2')).toBeLessThan(SCRIPT.indexOf('Add-Type'))
  })

  test('finds its window by the pid it was given, and errors when nothing answers to it', () => {
    expect(SCRIPT).toMatch(/Get-Process -Id \$ProcessId -ErrorAction Stop/)
  })

  test('says it understands the display’s scaling before it measures a window', () => {
    expect(SCRIPT).toContain('SetProcessDpiAwarenessContext')
    expect(SCRIPT).toContain('[NibDpi]::Ask()')
    expect(SCRIPT.indexOf('[NibDpi]::Ask()')).toBeLessThan(SCRIPT.indexOf('Get-Process -Id'))
    expect(SCRIPT.indexOf('[NibDpi]::Ask()')).toBeLessThan(SCRIPT.indexOf('GetWindowRect($handle'))
  })

  test.each(CALLERS)('%s passes a pid', (relative) => {
    const caller = read(relative)
    expect(caller).toContain('capture-window.ps1')
    expect(caller).toMatch(/'-(Pid|ProcessId)',|"-(Pid|ProcessId)",/)
    expect(caller).not.toMatch(/-ProcessName/)
  })

  test('the command line says so rather than guessing when the app named no process', () => {
    const cli = read('../../../apps/cli/orden.mjs')
    expect(cli).toContain('did not say which process it is')
    expect(cli).not.toMatch(/pid \? \[/)
  })

  test('the command line photographs a Mac window by its number, not its rectangle', () => {
    const cli = read('../../../apps/cli/orden.mjs')
    expect(cli).toContain('kCGWindowOwnerPID === Number(argv[0])')
    expect(cli).toMatch(/'-l\$\{id\}'|`-l\$\{id\}`/)
    expect(cli).not.toMatch(/`-R\$\{/)
  })
})
