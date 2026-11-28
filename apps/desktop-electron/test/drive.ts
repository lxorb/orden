import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const IDENTIFIER = 'so.orden.Orden.Electron'
const TAURI = 'so.orden.Orden'
const FORMER =
  /const FORMER: &str = "(\w+)";/.exec(
    readFileSync(
      join(import.meta.dirname, '..', '..', 'desktop', 'src-tauri', 'crates', 'base', 'src', 'former_spaces.rs'),
      'utf8',
    ),
  )?.[1] ?? ''
const MARKER = `electron-shell-drive-${Date.now().toString(36)}`
const FIRST_SCREEN = ['Use without an account', 'Skip', 'Continue', 'Done', 'Get started']
const { values: asked } = parseArgs({
  options: {
    shell: { type: 'string' },
    app: { type: 'string' },
    out: { type: 'string', default: join(import.meta.dirname, '..', 'dist', 'drive') },
    home: { type: 'string' },
    arg: { type: 'string', multiple: true, default: [] },
  },
})
if (!FORMER) throw new Error('former_spaces.rs no longer names the former spaces folder')
if (!asked.shell) {
  console.error(
    'usage: node test/drive.ts --shell <electron> [--app <folder>] [--out <folder>] [--home <folder>] [--arg <switch>]',
  )
  process.exit(2)
}
const shell = asked.shell
const out = asked.out
const sandbox = process.platform === 'linux' ? asked.home : undefined
const home = sandbox ?? homedir()
mkdirSync(out, { recursive: true })
const env: NodeJS.ProcessEnv = { ...process.env, ORDEN_USAGE: 'off', ORDEN_ELECTRON_TRACE: '1' }
if (sandbox)
  Object.assign(env, {
    HOME: sandbox,
    XDG_CONFIG_HOME: join(sandbox, '.config'),
    XDG_DATA_HOME: join(sandbox, '.local', 'share'),
    XDG_CACHE_HOME: join(sandbox, '.cache'),
  })
delete env.ORDEN_SPACES_DIR
const places = ((): { config: string; data: string } => {
  if (process.platform === 'win32')
    return {
      config: process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      data: process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
    }
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return { config: support, data: support }
  }
  return { config: join(home, '.config'), data: join(home, '.local', 'share') }
})()
const tauriPlaces = [join(places.config, TAURI), join(places.data, TAURI), join(home, 'Documents', FORMER)]
function samePath(one: string, other: string): boolean {
  const plain = (path: string): string => {
    const short = resolve(path.replace(/^\\\\\?\\/, ''))
    return process.platform === 'win32' ? short.toLowerCase() : short
  }
  return plain(one) === plain(other)
}
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
async function until<Found>(what: string, patience: number, look: () => Promise<Found | null | false | undefined>) {
  const end = Date.now() + patience
  for (;;) {
    const found = await look()
    if (found) return found
    if (Date.now() > end) throw new Error(`waited ${patience} ms for ${what}`)
    await sleep(200)
  }
}
function walked(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) walked(at, found)
    else if (entry.isFile()) found.push(at)
  }
  return found
}
function snapshot(): string {
  const seen = tauriPlaces.flatMap((place) =>
    existsSync(place)
      ? walked(place).map(
          (file) => `${file} ${statSync(file).mtimeMs} ${createHash('sha1').update(readFileSync(file)).digest('hex')}`,
        )
      : [`${place} absent`],
  )
  return seen.sort().join('\n')
}
interface Running {
  pid: number
  parent: number
  command: string
}
function processes(): Running[] {
  if (process.platform === 'win32') {
    const said = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 1 << 26 },
    )
    const all = JSON.parse(said.stdout) as { ProcessId: number; ParentProcessId: number; CommandLine: string | null }[]
    return all.map((one) => ({ pid: one.ProcessId, parent: one.ParentProcessId, command: one.CommandLine ?? '' }))
  }
  const said = spawnSync('ps', ['-axo', 'pid=,ppid=,stat=,args='], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return said.stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && !match[3]!.startsWith('Z'))
    .map((match) => ({ pid: Number(match![1]), parent: Number(match![2]), command: match![4]! }))
}
function family(root: number): Running[] {
  const all = processes()
  const found: Running[] = []
  const walk = (parent: number): void => {
    for (const one of all.filter((each) => each.parent === parent)) {
      found.push(one)
      walk(one.pid)
    }
  }
  walk(root)
  return found
}
function alive(pids: number[]): Running[] {
  return processes().filter((one) => pids.includes(one.pid))
}
class Cdp {
  readonly #socket: WebSocket
  readonly #waiting = new Map<number, { done: (value: any) => void; failed: (error: Error) => void }>()
  #last = 0
  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const said = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
      const waiting = said.id === undefined ? undefined : this.#waiting.get(said.id)
      if (!waiting || said.id === undefined) return
      this.#waiting.delete(said.id)
      if (said.error) waiting.failed(new Error(said.error.message))
      else waiting.done(said.result)
    })
    socket.addEventListener('close', () => {
      for (const waiting of this.#waiting.values()) waiting.failed(new Error('the shell hung up'))
      this.#waiting.clear()
    })
  }
  static open(url: string): Promise<Cdp> {
    return new Promise((done, failed) => {
      const socket = new WebSocket(url)
      socket.addEventListener('open', () => {
        done(new Cdp(socket))
      })
      socket.addEventListener('error', () => {
        failed(new Error(`no DevTools at ${url}`))
      })
    })
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.#last
    return new Promise((done, failed) => {
      this.#waiting.set(id, { done, failed })
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  close(): void {
    this.#socket.close()
  }
}
interface Launched {
  child: ChildProcess
  pid: number
  cdp: Cdp
  session: string
  log: string[]
  exit: Promise<number | null>
  page: <Value>(code: string) => Promise<Value>
  shot: (name: string) => Promise<void>
}
function started(name: string): { child: ChildProcess; log: string[]; exit: Promise<number | null> } {
  const child = spawn(shell, [...(asked.app ? [asked.app] : []), '--remote-debugging-port=0', ...asked.arg], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log: string[] = []
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      log.push(chunk.toString())
      writeFileSync(join(out, `${name}.log`), log.join(''))
    })
  const exit = new Promise<number | null>((done) => child.on('exit', (code) => done(code)))
  return { child, log, exit }
}
async function launch(name: string): Promise<Launched> {
  const { child, log, exit } = started(name)
  const pid = child.pid
  if (pid === undefined) throw new Error(`${shell} did not start`)
  const address = await until(
    'the DevTools address',
    30000,
    async () => /DevTools listening on (ws:\S+)/.exec(log.join(''))?.[1],
  )
  const cdp = await Cdp.open(address)
  const target = await until('the page', 60000, async () => {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: { targetId: string; type: string; url: string }[]
    }
    return targetInfos.find((one) => one.type === 'page' && one.url.startsWith('tauri://localhost'))
  })
  const { sessionId: session } = (await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })) as { sessionId: string }
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session)
  const page = async <Value>(code: string): Promise<Value> => {
    const said = await cdp.send(
      'Runtime.evaluate',
      { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true },
      session,
    )
    if (said.exceptionDetails)
      throw new Error(said.exceptionDetails.exception?.description ?? said.exceptionDetails.text)
    return said.result.value as Value
  }
  const shot = async (file: string): Promise<void> => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    writeFileSync(join(out, file), Buffer.from(data, 'base64'))
  }
  return { child, pid, cdp, session, log, exit, page, shot }
}
async function editorReady(run: Launched): Promise<string[]> {
  const clicked: string[] = []
  let quiet = 0
  await until('the editor', 120000, async () => {
    const one = await run.page<string | null>(`
      const buttons = [...document.querySelectorAll('button,a,[role=button]')].filter((one) => !one.disabled)
      for (const label of ${JSON.stringify(FIRST_SCREEN)}) {
        const found = buttons.find((one) => (one.innerText ?? '').trim() === label)
        if (found) { found.click(); return label }
      }
      return null`)
    if (one) {
      clicked.push(one)
      quiet = 0
      await sleep(600)
      return false
    }
    quiet = (await run.page<boolean>(`return !!document.querySelector('.cm-content')`)) ? quiet + 1 : 0
    return quiet > 12
  })
  return clicked
}
async function gone(what: string, pids: number[], patience: number): Promise<void> {
  await until(what, patience, async () => alive(pids).length === 0).catch(() => {
    throw new Error(
      `${what}: still running: ${alive(pids)
        .map((one) => `${one.pid} ${one.command.slice(0, 120)}`)
        .join(' | ')}`,
    )
  })
}
const results: Record<string, unknown> = {
  platform: process.platform,
  arch: process.arch,
  sandbox: sandbox ?? null,
  marker: MARKER,
}
const failed: string[] = []
const runs: { first?: Launched; again?: Launched } = {}
function save(): void {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ ...results, failed, pass: failed.length === 0 }, null, 1))
}
async function step(name: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    results[name] = (await run()) ?? true
    console.error(`[drive] ${name}: ${JSON.stringify(results[name]).slice(0, 600)}`)
    save()
    return true
  } catch (error) {
    results[name] = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) }
    failed.push(name)
    await (runs.again ?? runs.first)?.shot(`failed-${failed.length}.png`).catch(() => null)
    console.error(`[drive] ${name} FAILED: ${JSON.stringify(results[name])}`)
    save()
    return false
  }
}
if (sandbox) {
  for (const [file, text] of [
    [join(places.config, TAURI, 'spaces-folder'), join(places.data, TAURI, 'Spaces')],
    [join(places.data, TAURI, 'Spaces', 'Notes', 'Kept.md'), '# A note of the Tauri app\n'],
    [join(home, 'Documents', FORMER, 'Old', 'Note.md'), '# A note from before the rename\n'],
  ] as const) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
  }
}
const before = snapshot()
let pids: number[] = []
let spacesRoot = ''
await step('starts', async () => {
  const first = await launch('first')
  runs.first = first
  const clicked = await editorReady(first)
  const facts = await first.page<{ spacesRoot: string }>(`
    const internals = window.__TAURI_INTERNALS__
    return {
      url: location.href,
      label: internals.metadata.currentWebview.label,
      post: typeof window.ipc?.postMessage,
      title: document.title,
      agent: navigator.userAgent,
      spacesRoot: await internals.invoke('spaces_root'),
    }`)
  spacesRoot = facts.spacesRoot
  await first.shot('started.png')
  return { clicked, ...facts }
})
if (runs.first) {
  const run = runs.first
  await step('a note is opened and edited', async () => {
    const title = await run.page<string>(`
      const editor = document.querySelector('.cm-content')
      editor.focus()
      getSelection().collapse(editor, 0)
      return document.title`)
    await sleep(500)
    await run.cdp.send('Input.insertText', { text: `${MARKER} typed in the Electron shell\n\n` }, run.session)
    const file = await until('the note on disk', 30000, async () =>
      walked(spacesRoot).find((one) => one.endsWith('.md') && readFileSync(one, 'utf8').includes(MARKER)),
    )
    await sleep(1500)
    await run.shot('edited.png')
    const asset = await run.page<{ status: number; bytes: number }>(`
      const answer = await fetch(window.__TAURI_INTERNALS__.convertFileSrc(${JSON.stringify(file)}))
      return { status: answer.status, bytes: (await answer.arrayBuffer()).byteLength }`)
    if (asset.status !== 200 && asset.status !== 403) throw new Error(`the asset scheme answered ${asset.status}`)
    return { title, file, text: readFileSync(file, 'utf8').slice(0, 120), asset }
  })
  await step('what the shell cannot do yet is refused without a crash', async () => {
    const tried = await run.page<Record<string, unknown>>(`
      const invoke = window.__TAURI_INTERNALS__.invoke
      const calls = {
        drag: () => invoke('plugin:window|start_dragging', { label: 'main' }),
        web: () => invoke('web_open', {
          tab: 'drive-probe',
          url: 'https://example.com/',
          pane: { x: 300, y: 60, width: 600, height: 400 },
          ground: null,
          revived: { place: null, trail: [], at: 0 },
          profile: { store: null, private: true, pass: false },
        }),
      }
      const tried = {}
      for (const [name, call] of Object.entries(calls)) {
        try {
          tried[name] = { answered: (await call()) ?? null }
        } catch (error) {
          tried[name] = { refused: String(error) }
        }
      }
      return tried`)
    await sleep(1500)
    const cores = family(run.pid).filter((one) => one.command.includes('--orden-electron-pipe='))
    if (cores.length !== 1) throw new Error(`the core is gone after ${JSON.stringify(tried)}`)
    if (!(await run.page<boolean>(`return !!document.querySelector('.cm-content')`)))
      throw new Error('the page is gone')
    await run.shot('refused.png')
    return tried
  })
  await step('a second launch leaves the first alone', async () => {
    const second = started('second')
    const code = await Promise.race([second.exit, sleep(20000).then(() => 'still running' as const)])
    if (code === 'still running') second.child.kill('SIGKILL')
    if (code !== 0) throw new Error(`the second launch ended with ${String(code)}: ${second.log.join('').slice(-400)}`)
    const cores = family(run.pid).filter((one) => one.command.includes('--orden-electron-pipe='))
    if (cores.length !== 1) throw new Error(`${cores.length} cores run under the first shell`)
    return { code, alive: await run.page<boolean>(`return !!document.querySelector('.cm-content')`) }
  })
  await step('closing the window ends the shell and the core', async () => {
    const running = family(run.pid)
    pids = [run.pid, ...running.map((one) => one.pid)]
    const core = running.filter((one) => one.command.includes('--orden-electron-pipe='))
    if (core.length !== 1) throw new Error(`expected one core, found ${core.length}`)
    const began = Date.now()
    void run.cdp
      .send(
        'Runtime.evaluate',
        { expression: `window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })` },
        run.session,
      )
      .catch(() => null)
    let stays = false
    if (process.platform === 'darwin') {
      await until('the window to close', 20000, async () => {
        const { targetInfos } = (await run.cdp.send('Target.getTargets')) as { targetInfos: { type: string }[] }
        return !targetInfos.some((one) => one.type === 'page')
      })
      await sleep(1000)
      stays = run.child.exitCode === null
      if (!stays) throw new Error('on a Mac the app stays when its last window closes, and this one left')
      run.child.kill('SIGTERM')
    }
    const code = await Promise.race([run.exit, sleep(30000).then(() => 'still running' as const)])
    if (code !== 0) throw new Error(`the shell ended with ${String(code)}`)
    await gone('the processes of the first run', pids, 15000)
    return { code, stays, processes: pids.length, ms: Date.now() - began }
  })
}
await step('the note is there after a restart', async () => {
  const run = await launch('again')
  runs.again = run
  await editorReady(run)
  const text = await until('the note in the editor', 45000, async () =>
    run.page<string | null>(`
      const found = [...document.querySelectorAll('.cm-content')].find((one) => one.innerText.includes(${JSON.stringify(MARKER)}))
      return found ? found.innerText.slice(0, 200) : null`),
  )
  await sleep(1000)
  await run.shot('restarted.png')
  const file = walked(spacesRoot).find((one) => one.endsWith('.md') && readFileSync(one, 'utf8').includes(MARKER))
  if (!file) throw new Error('the note is no longer on disk')
  return { title: await run.page<string>(`return document.title`), text, file }
})
if (runs.again) {
  const run = runs.again
  await step('a killed shell takes the core with it', async () => {
    const running = family(run.pid)
    const core = running.filter((one) => one.command.includes('--orden-electron-pipe='))
    if (core.length !== 1) throw new Error(`expected one core, found ${core.length}`)
    const began = Date.now()
    run.child.kill('SIGKILL')
    await run.exit
    await gone(
      'the processes of the killed shell',
      running.map((one) => one.pid),
      20000,
    )
    return { processes: running.length, ms: Date.now() - began }
  })
}
await step('the Tauri app is left alone', async () => {
  const userData = join(places.config, IDENTIFIER, 'shell')
  const own = join(places.data, IDENTIFIER, 'Spaces')
  if (!existsSync(userData) || readdirSync(userData).length === 0)
    throw new Error(`the shell keeps nothing in ${userData}`)
  if (!samePath(spacesRoot, own)) throw new Error(`the spaces are in ${spacesRoot}, not in ${own}`)
  if (snapshot() !== before) throw new Error(`a folder of the Tauri app changed:\n${before}\n---\n${snapshot()}`)
  return {
    userData,
    spacesRoot,
    untouched: tauriPlaces.map((place) => `${place}: ${existsSync(place) ? 'as it was' : 'absent'}`),
    seeded: !!sandbox,
  }
})
for (const run of [runs.first, runs.again]) {
  run?.cdp.close()
  run?.child.kill('SIGKILL')
}
save()
console.error(failed.length ? `RESULT: FAIL (${failed.join(', ')})` : 'RESULT: PASS')
process.exit(failed.length ? 1 : 0)
