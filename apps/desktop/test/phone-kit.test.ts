import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ORDEN_APPS } from '../app-build'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const E2E = join(import.meta.dirname, 'e2e')
const ASKING = `
import json, sys, types

api = types.ModuleType("playwright.sync_api")
api.Page = type("Page", (), {"on": lambda self, event, handler: None})
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = api
sys.path.insert(0, sys.argv[1])
import phone_kit
print(json.dumps({"crashes": phone_kit.crashes(sys.argv[2], sys.argv[3]), "packages": phone_kit.packages()}))
`
function asked(log: string, id: string): { crashes: string[]; packages: Record<string, string> } {
  return JSON.parse(execFileSync('python3', ['-c', ASKING, E2E, log, id], { encoding: 'utf8' })) as {
    crashes: string[]
    packages: Record<string, string>
  }
}
interface PhoneApp {
  app: string
  id: string
  built: boolean
  driven: boolean
}
function phoneApps(): PhoneApp[] {
  const said = execFileSync('node', [join(ROOT, 'scripts', 'phone-apps.mjs'), '--table'], { encoding: 'utf8' })
  return JSON.parse(said) as PhoneApp[]
}
const at = '11-26 19:26:29.823  4945  4945'
const JAVA = [
  `${at} E AndroidRuntime: FATAL EXCEPTION: main`,
  `${at} E AndroidRuntime: Process: so.orden.Orden, PID: 4945`,
  `${at} E AndroidRuntime: java.lang.IllegalStateException: no window`,
].join('\n')
const OTHERS = [
  `${at} E AndroidRuntime: FATAL EXCEPTION: main`,
  `${at} E AndroidRuntime: Process: com.android.vending, PID: 4945`,
  `${at} F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 9 (binder), pid 9 (com.android.phone)`,
  `${at} E ActivityManager: ANR in com.google.android.gms`,
  `${at} E ActivityManager: ANR in so.orden.Ordering (so.orden.Ordering/.Main)`,
  `${at} I ActivityManager: Killing 4945:so.orden.Orden/u0a192 (adj 0): depends on provider com.google.android.gms/.fonts.provider.FontsProvider in dying proc com.google.android.gms.persistent (adj -10000)`,
].join('\n')
describe('what a phone drive calls a crash (#2286)', () => {
  test('an exception, a signal, an ANR and a panic of the app are each one', () => {
    const signal = `${at} F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 5001 (RenderThread), pid 4945 (so.orden.Orden)`
    const anr = `${at} E ActivityManager: ANR in so.orden.Orden (so.orden.Orden/.MainActivity)`
    const panic = `${at} E RustStdoutStderr: thread 'main' panicked at src/lib.rs:10:5:`
    const found = asked([JAVA, signal, anr, panic].join('\n'), 'so.orden.Orden').crashes
    expect(found.map((one) => one.split(':')[0])).toEqual(['crash', 'signal', 'ANR', 'panic'])
    expect(found[0]).toContain('IllegalStateException')
  })
  test('another app falling over, and the phone killing the app with Play services, are not', () => {
    expect(asked(OTHERS, 'so.orden.Orden').crashes).toEqual([])
  })
  test('the scan runs at the end of every drive, whatever its steps did', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    const ending = kit.slice(kit.indexOf('        finally:'))
    expect(ending).toContain('for one in crashes(log, self.package):')
    expect(ending).toContain('self.wrong(one)')
  })
})
describe('the phone apps CI builds and drives (#2286)', () => {
  test('are the rows of the one Gradle table, each with the id the drive starts', () => {
    const apps = phoneApps()
    expect(apps.map((one) => one.app).sort()).toEqual([...ORDEN_APPS].filter((app) => app !== 'orden').sort())
    const ids = asked('', 'so.orden.Orden').packages
    for (const one of apps) expect(ids[one.app], one.app).toBe(one.id)
  })
  test('are built once they have an overlay and driven once they have a drive too', () => {
    for (const one of phoneApps()) {
      const overlay = existsSync(join(ROOT, 'apps', 'desktop', 'src-tauri', `tauri.${one.app}.conf.json`))
      const drive = existsSync(join(E2E, `${one.app}-phone.py`))
      expect(one.built, one.app).toBe(overlay)
      expect(one.driven, one.app).toBe(overlay && drive)
    }
    expect(phoneApps().find((one) => one.app === 'notes')).toMatchObject({ built: true, driven: true })
  })
  test('phone.yml and its matrix come from that table, and a drive is run by its app name', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'phone.yml'), 'utf8')
    expect(workflow).toContain('node scripts/phone-apps.mjs --driven')
    expect(workflow).toContain('app: ${{ fromJson(needs.apps.outputs.apps) }}')
    expect(workflow).toContain('apps/desktop/test/e2e/${{ matrix.app }}-phone.py')
    expect(workflow).toContain("branches: ['tmp/ci-phone*', unstable]")
    expect(workflow).toContain('git diff --name-only "$BEFORE" "$GITHUB_SHA" | grep -qE "$NATIVE" || go=false')
    expect(workflow).not.toContain('apps/desktop/src-tauri/src/**')
  })
})
