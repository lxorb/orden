import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import budgets from '../phone-budgets.json'
import { ORDEN_APPS } from '../app-build'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')
const workflow = read('.github', 'workflows', 'publish-mobile.yml')
const MB = 1024 * 1024
const APK_TARGETS: Record<string, number> = { notes: 30 * MB, track: 22 * MB, todo: 22 * MB, chat: 25 * MB }
interface Budget {
  most?: number
  least?: number
  target: number
}
const held = budgets as Record<string, Record<string, Budget>>
interface Row {
  gate: string
  passed: boolean
  reached?: boolean
  said: string
}
function judged(table: unknown, app: string, measured: Record<string, number>): Row[] {
  const script = `import { judge } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'phone-budget.mjs')).href)}
console.log(JSON.stringify(judge(JSON.parse(process.argv[1]), process.argv[2], JSON.parse(process.argv[3]))))`
  const said = execFileSync(
    'node',
    ['--input-type=module', '-e', script, JSON.stringify(table), app, JSON.stringify(measured)],
    { encoding: 'utf8' },
  )
  return JSON.parse(said) as Row[]
}
function versionOf(ref: string, run: string): Record<string, string> {
  const out = join(mkdtempSync(join(tmpdir(), 'orden-version-')), 'out')
  execFileSync('bash', [join(ROOT, 'scripts', 'build-version.sh')], {
    cwd: ROOT,
    env: {
      ...process.env,
      GITHUB_REF: ref,
      GITHUB_REF_NAME: ref.split('/').at(-1) ?? '',
      GITHUB_RUN_NUMBER: run,
      GITHUB_OUTPUT: out,
    },
  })
  const said = readFileSync(out, 'utf8')
  return Object.fromEntries(
    said
      .trim()
      .split('\n')
      .map((line) => line.split('=') as [string, string]),
  )
}
describe('a phone budget (#2286)', () => {
  const table = { notes: { apkBytes: { most: 100, target: 80 }, framesInTime: { least: 90, target: 95 } } }
  test('passes at the bound, fails past it, and says when the target is not reached', () => {
    const [size, frames] = judged(table, 'notes', { apkBytes: 100, framesInTime: 90 })
    expect(size).toMatchObject({ passed: true, reached: false })
    expect(frames).toMatchObject({ passed: true, reached: false })
    expect(size?.said).toContain('target 80 not reached')
    expect(judged(table, 'notes', { apkBytes: 101 })[0]?.passed).toBe(false)
    expect(judged(table, 'notes', { framesInTime: 89.9 })[0]?.passed).toBe(false)
    expect(judged(table, 'notes', { apkBytes: 80 })[0]).toMatchObject({ passed: true, reached: true })
  })
  test('fails a measure nobody budgeted, and an app with no budgets', () => {
    expect(judged(table, 'notes', { coldStart: 1 })[0]).toMatchObject({ passed: false })
    expect(judged(table, 'chat', { apkBytes: 1 })[0]?.said).toContain('no budget')
  })
  test('is held for everything a drive measures, in every app that has a drive', () => {
    const kit = readFileSync(join(ROOT, 'apps', 'desktop', 'test', 'e2e', 'phone_kit.py'), 'utf8')
    const gates = [...new Set([...kit.matchAll(/self\.gates\["(\w+)"\]/g)].map((one) => one[1] ?? ''))]
    expect(gates.sort()).toEqual(
      [
        'backgroundCpu',
        'backgroundRequests',
        'backgroundWakeLocks',
        'coldStartP50',
        'coldStartP95',
        'flingsWithLongFrame',
        'framesInTime',
        'memoryGrowth',
        'memoryPss',
        'textScaleFollowed',
        'warmP95',
      ].sort(),
    )
    const TARGETS: Record<string, number> = {
      coldStartP50: 1500,
      coldStartP95: 2500,
      warmP95: 600,
      framesInTime: 90,
      flingsWithLongFrame: 0,
      textScaleFollowed: 1,
      memoryPss: 220,
      memoryGrowth: 0,
      backgroundRequests: 0,
      backgroundCpu: 1,
      backgroundWakeLocks: 0,
    }
    const LOOSE = ['flingsWithLongFrame', 'memoryGrowth', 'backgroundRequests']
    const NOT_REACHED: Record<string, string[]> = { notes: ['memoryPss'] }
    for (const app of ORDEN_APPS) {
      if (!existsSync(join(ROOT, 'apps', 'desktop', 'test', 'e2e', `${app}-phone.py`))) continue
      for (const gate of gates) {
        const budget = held[app]?.[gate]
        expect(budget?.target, `${app} ${gate}`).toBe(TARGETS[gate])
        const floor = budget?.least !== undefined
        const bound = floor ? budget.least : budget?.most
        expect(bound, `${app} ${gate}`).toBeDefined()
        if (NOT_REACHED[app]?.includes(gate)) {
          expect(floor ? Number(bound) < TARGETS[gate]! : Number(bound) > TARGETS[gate]!, `${app} ${gate}`).toBe(true)
        } else if (!LOOSE.includes(gate)) {
          expect(floor ? Number(bound) >= TARGETS[gate]! : Number(bound) <= TARGETS[gate]!, `${app} ${gate}`).toBe(true)
        }
      }
    }
  })
  test('is held for the APK of every app that has an overlay, against the size the plan asks for', () => {
    for (const app of ORDEN_APPS) {
      if (app === 'orden' || !existsSync(join(ROOT, 'apps', 'desktop', 'src-tauri', `tauri.${app}.conf.json`))) continue
      const budget = held[app]?.apkBytes
      expect(budget, app).toBeDefined()
      expect(budget?.target, app).toBe(APK_TARGETS[app])
      expect(budget?.most, app).toBeGreaterThan(MB)
    }
  })
})
describe('what a push to unstable builds for phones (#2286)', () => {
  const job = workflow.slice(workflow.indexOf('\n  android:\n'), workflow.indexOf('\n  ios:\n'))
  test('the whole Orden and every app with an overlay, from the one table', () => {
    expect(workflow).toContain(`node scripts/phone-apps.mjs --built | jq -c '["orden"] + .'`)
    expect(job).toContain('app: ${{ fromJson(needs.version.outputs.apps) }}')
    expect(job).toContain('ORG_GRADLE_PROJECT_ordenApp: ${{ matrix.app }}')
    expect(job).toContain('--config "src-tauri/tauri.$APP.conf.json"')
    expect(job).not.toMatch(/tauri\.(notes|todo|chat|track)\.conf\.json/)
  })
  test('each app measured against its APK budget', () => {
    expect(job).toContain('node scripts/phone-budget.mjs "$APP" "apkBytes=$(stat -c %s "out/$APP-arm64-release.apk")"')
  })
  test('with one version and one version code for all of them, higher with every build', () => {
    expect(job).toContain('"version":"${{ needs.version.outputs.version }}"')
    expect(job).toContain('"versionCode":${{ needs.version.outputs.code }}')
    expect(job.match(/--config "\$VERSIONED"/g)).toHaveLength(2)
    const earlier = versionOf('refs/heads/unstable', '2553')
    const later = versionOf('refs/heads/unstable', '2554')
    const tagged = versionOf('refs/tags/v0.22.6', '2555')
    expect(Number(later.code)).toBe(Number(earlier.code) + 1)
    expect(Number(tagged.code)).toBe(Number(later.code) + 1)
    const old = (version: string) => {
      const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
      return major * 1_000_000 + minor * 1000 + patch
    }
    expect(old('0.22.5')).toBe(22_005)
    const first = Number(versionOf('refs/heads/unstable', '1').code)
    for (const shipped of ['0.22.5', '0.22.6', '0.99.999']) expect(first, shipped).toBeGreaterThan(old(shipped))
    expect(versionOf('refs/heads/unstable', '2553').code).toBe(earlier.code)
    expect(new Set([earlier.code, later.code, tagged.code]).size).toBe(3)
    expect(Number(tagged.code)).toBeLessThan(2_100_000_000)
    expect(tagged.version).toBe('0.22.6')
  })
  test('signed with the release key, found by its alias or the build fails (#367)', () => {
    expect(job).toContain('if [ -z "$KEYSTORE" ] && [ "$REPOSITORY" = lxorb/orden ]; then')
    expect(job).toMatch(/if \[ -z "\$KEY_ALIAS" \]; then\s+echo "::error::ANDROID_KEY_ALIAS is not set[^\n]*\s+exit 1/)
  })
  test('and puts none of the new apps on a release until main says so', () => {
    expect(workflow).toMatch(/^env:\n {2}RELEASED_APPS: ''$/m)
    const naming = /- name: Name the downloads for humans\n([\s\S]*?)(?=\n {6}- )/.exec(workflow)?.[1] ?? ''
    expect(naming).toContain('case " $RELEASED_APPS " in *" $app "*) ;; *) continue ;; esac')
  })
})
