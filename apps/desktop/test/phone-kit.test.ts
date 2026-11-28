import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { entryOf, ORDEN_APPS, type OrdenApp } from '../app-build'

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
  test('an abort is one whatever library it came from, that of the phone included', () => {
    const signal = `${at} F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 5680 (Thread-3), pid 4945 (so.orden.Orden)`
    const dump = '11-27 11:25:07.350  6474  6474 F DEBUG   :'
    const exiting = [
      signal,
      `${dump} Abort message: 'FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x7f7fd6d39018)'`,
      `${dump}       #08 pc 000000000000ae4b  /vendor/lib64/egl/libEGL_emulation.so (eglDisplay::~eglDisplay()+11)`,
      `${dump}       #10 pc 00000000000c334e  /apex/com.android.runtime/lib64/bionic/libc.so (exit+14)`,
    ]
    expect(asked(exiting.join('\n'), 'so.orden.Orden').crashes).toHaveLength(1)
  })
  test('Back on the first screen is checked to keep the app and its page, by the drive of every app', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    const out = kit.slice(kit.indexOf('    def steps_out('), kit.indexOf('    def again('))
    expect(out).toContain('ended the app instead of keeping it in the background')
    expect(out).toContain('coming back after Back started the page again')
    expect(out).toContain('coming back after Back lost state')
    expect(kit).not.toContain('libEGL_emulation')
  })
  test('text that wraps is compared line by line, so a heading under its own mark is not text on text', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    expect(kit).toContain('return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)')
    expect(kit).toContain('if (wide > 2 && tall > 2 && crossing(one, other)) overlapping.push(')
  })
  test('the scan runs at the end of every drive, whatever its steps did', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    const ending = kit.slice(kit.indexOf('        finally:'))
    expect(ending).toContain('for one in crashes(log, self.package):')
    expect(ending).toContain('self.wrong(one)')
  })
})
const MEASURING = `
import json, sys, types

api = types.ModuleType("playwright.sync_api")
api.Page = type("Page", (), {"on": lambda self, event, handler: None})
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = api
sys.path.insert(0, sys.argv[1])
import phone_kit
asked = json.loads(sys.argv[2])
print(json.dumps({
  "frames": phone_kit.frames(asked["stats"]),
  "janky": phone_kit.janky(asked["stats"]),
  "drawn": phone_kit.fully_drawn(asked["log"], "so.orden.Orden"),
  "ranked": [phone_kit.ranked(asked["values"], one) for one in asked["percents"]],
  "launched": phone_kit.launched(asked["start"]),
}))
`
function measured(asked: { stats: string; values: number[]; percents: number[]; start: string; log: string }) {
  const said = execFileSync('python3', ['-c', MEASURING, E2E, JSON.stringify(asked)], { encoding: 'utf8' })
  return JSON.parse(said) as {
    frames: [number, boolean][]
    janky: number | null
    drawn: number[]
    ranked: number[]
    launched: number
  }
}
describe('what a phone drive measures (#2286)', () => {
  const columns =
    'Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,' +
    'PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,' +
    'IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,'
  const frame = (flags: number, began: number, ended: number) =>
    `${flags},7,${began},${began},0,1,1,1,1,${began + 18_000_000},16666666,1,1,1,1,1,${ended},1,1,1,`
  const old = 'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,FrameCompleted,'
  const asked = {
    stats: [
      'Stats since: 1ns',
      'Janky frames: 40 (33.33%)',
      '---PROFILEDATA---',
      columns,
      frame(0, 1_000_000_000, 1_017_500_000),
      frame(1, 2_000_000_000, 2_900_000_000),
      frame(0, 3_000_000_000, 3_040_000_000),
      frame(0, 4_000_000_000, 0),
      '---PROFILEDATA---',
      old,
      '0,5000000000,5000000000,0,0,1,5008000000,',
      '---PROFILEDATA---',
    ].join('\n'),
    values: [...Array(20).keys()].map((one) => one + 1),
    percents: [50, 95, 100],
    start: 'Status: ok\nLaunchState: COLD\nTotalTime: 812\nWaitTime: 820',
    log: [
      '11-27 10:00:01.000   520   544 I ActivityTaskManager: Displayed so.orden.Orden/.MainActivity: +540ms',
      '11-27 10:00:02.000   520   544 I ActivityTaskManager: Fully drawn so.orden.Orden/.MainActivity: +1s234ms',
      '11-27 10:00:03.000   520   544 I ActivityTaskManager: Fully drawn so.orden.Ordering/.Main: +2s1ms',
      '11-27 10:00:04.000   520   544 I ActivityTaskManager: Fully drawn so.orden.Orden/.MainActivity: +870ms',
      '11-27 10:00:05.000   520   544 I ActivityTaskManager: Fully drawn so.orden.Orden/.MainActivity: +1m2s3ms',
    ].join('\n'),
  }
  test('a frame is in time when it ends by its deadline, not by a fixed 16.7 ms', () => {
    expect(measured(asked).frames).toEqual([
      [17.5, true],
      [40, false],
      [8, true],
    ])
  })
  test('without a deadline column, the deadline is one vsync after the intended one', () => {
    const late = { ...asked, stats: asked.stats.replace('5008000000', '5017000000') }
    expect(measured(late).frames.at(-1)?.[1]).toBe(false)
  })
  test('the count the phone itself keeps of janky frames is read beside it', () => {
    expect(measured(asked).janky).toBe(33.33)
    expect(measured({ ...asked, stats: '' }).janky).toBe(null)
  })
  test('a cold start ends when the phone says the app is fully drawn, read from its own log line', () => {
    expect(measured(asked).drawn).toEqual([1234, 870, 62_003])
  })
  test('the median and the 95th of twenty starts are the tenth and the nineteenth', () => {
    expect(measured(asked).ranked).toEqual([10, 19, 20])
    expect(measured(asked).launched).toBe(812)
  })
})
const NIGHTLY = `
import json, sys, types

api = types.ModuleType("playwright.sync_api")
api.Page = type("Page", (), {"on": lambda self, event, handler: None})
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = api
sys.path.insert(0, sys.argv[1])
import phone_kit
asked = json.loads(sys.argv[2])
print(json.dumps({
  "pss": [phone_kit.pss(asked["memory"], one) for one in asked["pids"]],
  "ticks": [phone_kit.ticks(one) for one in asked["stats"]],
  "awake": phone_kit.held_awake(asked["power"], "so.orden.Orden", "10192"),
}))
`
describe('what a phone drive measures at night (#2286)', () => {
  const asked = {
    memory: [
      'Total RSS by process:',
      '    999,999K: so.orden.Orden (pid 5619 / activities)',
      '',
      'Total PSS by process:',
      '    153,600K: so.orden.Orden (pid 5619 / activities)',
      '     51,200K: com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0 (pid 5700)',
      '     20,480K: com.android.systemui (pid 900)',
      '',
      'Total PSS by OOM adjustment:',
      '    204,800K: Foreground',
      '        153,600K: so.orden.Orden (pid 5619 / activities)',
    ].join('\n'),
    pids: [['5619', '5700'], ['5619'], ['1']],
    stats: [
      '5619 (so.orden.Orden) S 345 345 0 0 -1 1077952832 1 2 3 4 150 50 0 0 20 0 60 0 100',
      '5700 (a (odd) name) S 345 345 0 0 -1 1077952832 1 2 3 4 7 3 0 0 20 0 60 0 100',
      '',
    ],
    power: [
      'Wake Locks: size=3',
      "  PARTIAL_WAKE_LOCK              'sync' ACQ=-2s (uid=10192 pid=5619)",
      "  PARTIAL_WAKE_LOCK              'job' ACQ=-9s (uid=1000 pid=520)",
      "  PARTIAL_WAKE_LOCK              'push' ACQ=-1s (uid=10050 pid=9 pkg=so.orden.Orden)",
      '',
      "  PARTIAL_WAKE_LOCK              'later' (uid=10192)",
    ].join('\n'),
  }
  const said = JSON.parse(
    execFileSync('python3', ['-c', NIGHTLY, E2E, JSON.stringify(asked)], { encoding: 'utf8' }),
  ) as {
    pss: number[]
    ticks: (number | null)[]
    awake: string[]
  }
  test('the memory an app holds is the total the phone sums up, in megabytes, of the app and its page', () => {
    expect(said.pss).toEqual([200, 150, 0])
  })
  test('it is weighed only after its page has collected its garbage, the app and its page apart', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    const weighs = kit.slice(kit.indexOf('    def weighs('), kit.indexOf('    def memory('))
    expect(weighs.indexOf('self.page.send("HeapProfiler.collectGarbage")')).toBeGreaterThan(-1)
    expect(weighs.indexOf('self.page.send("HeapProfiler.collectGarbage")')).toBeLessThan(weighs.indexOf('"dumpsys", "meminfo"'))
    expect(weighs).toContain('would not collect its garbage before it is weighed')
    for (const kept of ['memoryAppPss', 'memoryPagePss', 'memoryAppGrowth', 'memoryPageGrowth']) {
      expect(kit, kept).toContain(`self.notes["${kept}"]`)
    }
  })
  test('the processor time it took is its user and system ticks, whatever its name holds', () => {
    expect(said.ticks).toEqual([200, 10, null])
  })
  test('a wake lock belongs to the app when it names the app or its user id, and only inside the list', () => {
    expect(said.awake).toHaveLength(2)
    expect(said.awake[0]).toContain("'sync'")
    expect(said.awake[1]).toContain("'push'")
  })
  test('the nightly measures run only when the run says it is that of the night', () => {
    const kit = readFileSync(join(E2E, 'phone_kit.py'), 'utf8')
    expect(kit).toContain('NIGHT = os.environ.get("ORDEN_PHONE_NIGHT") == "true"')
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'phone.yml'), 'utf8')
    expect(workflow).toContain('script: ORDEN_PHONE_NIGHT=${{ inputs.night }} python3')
    for (const app of ['notes', 'track']) {
      const drive = readFileSync(join(E2E, `${app}-phone.py`), 'utf8')
      expect(drive, app).toMatch(
        /if phone_kit\.NIGHT:\n(?: {8}.*\n)*? {8}PHONE\.memory\(opens_and_closes\)\n {8}PHONE\.background\(PHONE\.asked\)/,
      )
    }
  })
})
describe('the phone apps CI builds and drives (#2286)', () => {
  test('each say when their first screen can be used, or a release build of them cannot be timed', () => {
    for (const one of phoneApps().filter((app) => app.built)) {
      const page = readFileSync(join(ROOT, 'apps', 'desktop', entryOf(one.app as OrdenApp)), 'utf8')
      const scripts = [...page.matchAll(/<script type="module" src="\/(src\/[\w-]+\.ts)">/g)].map(
        (found) => found[1] ?? '',
      )
      const marking = scripts.filter((script) =>
        readFileSync(join(ROOT, 'apps', 'desktop', script), 'utf8').includes("markPainted('shell painted')"),
      )
      expect(marking, `${one.app}: ${scripts.join(', ')}`).toHaveLength(1)
    }
  })
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
    expect(workflow).toContain('branches: [unstable]')
    expect(workflow).toContain(
      'node scripts/phone-budget.mjs "$APP" "--from=apps/desktop/test/e2e/shots/$APP-phone/gates.json"',
    )
    expect(workflow).toContain('cp "$android/app/build/outputs/apk/universal/release/app-universal-release.apk"')
    expect(workflow).not.toContain('secrets.')
  })
  test('a build that fails is tried again twice, since Maven Central refuses a download at times', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'phone.yml'), 'utf8')
    expect(workflow.match(/for attempt in 1 2 3; do/g)).toHaveLength(2)
    expect(workflow.match(/\[ "\$attempt" -lt 3 \] \|\| exit 1/g)).toHaveLength(2)
  })
  test('the app as it ships is built and timed only at night, in the run that builds the edge APKs', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'phone.yml'), 'utf8')
    const built = /- name: Build the app as it ships, to time its cold start\n([\s\S]*?)(?=\n {6}- )/.exec(
      workflow,
    )?.[1]
    expect(built).toContain('if: inputs.night')
    expect(built).toContain('VITE_ORDEN_API: http://127.0.0.1:8799')
    expect(built).toContain("-dname 'CN=Orden measure'")
    expect(workflow).toMatch(/workflow_call:\n {4}inputs:\n {6}app:/)
    const nightly = readFileSync(join(ROOT, '.github', 'workflows', 'publish-mobile.yml'), 'utf8')
    const gates = /\n {2}gates:\n([\s\S]*?)(?=\n {2}[\w-]+:\n)/.exec(nightly)?.[1] ?? ''
    expect(gates).toContain('uses: ./.github/workflows/phone.yml')
    expect(gates).toContain('night: true')
    expect(gates).toContain("inputs.platforms == 'all' && inputs.apps == 'all'")
    expect(readFileSync(join(E2E, 'phone_kit.py'), 'utf8')).toContain(
      'the cold start of a release build is not measured',
    )
    expect(workflow).toContain('git diff --name-only "$BEFORE" "$GITHUB_SHA" | grep -qE "$NATIVE" || go=false')
    expect(workflow).not.toContain('apps/desktop/src-tauri/src/**')
  })
})
