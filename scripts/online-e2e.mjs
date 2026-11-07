import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SYNC = join(ROOT, 'services/sync')
const CONFIG = 'wrangler.jsonc'
const PORT = Number(process.env.E2E_PORT ?? 8788)
const BASE = `http://127.0.0.1:${PORT}`
const ORDEND = process.env.E2E_ORDEND ?? 'http://127.0.0.1:7680'
const TOKEN = 'e2e-token-0123456789abcdef'
const USER = 'e2e-user'
const DEVICE = 'e2edevice01'
const windows = process.platform === 'win32'
const WRANGLER = join(SYNC, 'node_modules/wrangler/bin/wrangler.js')

const state = mkdtempSync(join(tmpdir(), 'orden-online-e2e-'))
const vars = join(state, 'dev.vars')
let worker = null
const opened = []

function log(...what) {
  console.log('[online-e2e]', ...what)
}

function wrangler(args) {
  const done = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: SYNC,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  })
  if (done.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')}: ${done.stdout}\n${done.stderr}`)
  }
  return done.stdout
}

function sql(command) {
  wrangler([
    'd1',
    'execute',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
    '--command',
    command,
  ])
}

const pause = (ms) => new Promise((settle) => setTimeout(settle, ms))

async function until(what, check, ms) {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await pause(200)
  }
}

function refusal(url) {
  return new Promise((settle) => {
    const asked = request(url.replace(/^ws/, 'http'), {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'ZTJlZTJlZTJlZTJlZTJlMg==',
        'sec-websocket-protocol': `nib.token.${TOKEN}, nib.device.${DEVICE}`,
      },
    })
    asked.on('upgrade', () => settle('it upgraded the second time'))
    asked.on('response', (answer) => {
      let body = ''
      answer.on('data', (chunk) => (body += chunk))
      answer.on('end', () => settle(`${answer.statusCode} ${body}`))
    })
    asked.on('error', (error) => settle(String(error)))
    asked.end()
  })
}

async function socket(session, since) {
  const url = `${BASE.replace(/^http/, 'ws')}/v2/online/${encodeURIComponent(session)}/socket`
  const ws = new WebSocket(url, [`nib.token.${TOKEN}`, `nib.device.${DEVICE}`])
  ws.binaryType = 'arraybuffer'
  const born = performance.now()
  const at = {}
  const first = (what) => (at[what] ??= Math.round(performance.now() - born))
  const heard = { frames: [], out: [], closed: false, at }
  const waiting = new Set()
  opened.push(heard)
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const frame = JSON.parse(event.data)
      first(frame.t === 'machine' ? `machine ${frame.state}` : frame.t)
      heard.frames.push(frame)
      return
    }
    first('out')
    const bytes = new Uint8Array(event.data)
    const seq = new DataView(bytes.buffer, bytes.byteOffset).getFloat64(0)
    const data = Buffer.from(bytes.subarray(8)).toString('utf8')
    heard.out.push({ seq, length: bytes.length - 8, data })
    for (const one of waiting) one(data)
  }
  ws.onclose = () => (heard.closed = true)
  await new Promise((opened, failed) => {
    ws.onopen = () => {
      first('open')
      opened()
    }
    ws.onerror = () =>
      void refusal(url).then((why) => failed(new Error(`socket to ${url} failed: ${why}`)))
  })
  ws.send(
    JSON.stringify({ t: 'hello', cols: 100, rows: 30, ...(since === undefined ? {} : { since }) }),
  )
  return {
    heard,
    text: () =>
      heard.frames
        .filter((one) => one.t === 'screen')
        .map((one) => one.data)
        .join('') + heard.out.map((one) => one.data).join(''),
    end: () =>
      heard.out.map((one) => one.seq + one.length).reduce((high, one) => Math.max(high, one), 0),
    type: (data) => ws.send(JSON.stringify({ t: 'in', data })),
    send: (frame) => ws.send(JSON.stringify(frame)),
    typeBytes: (data) => ws.send(new TextEncoder().encode(data)),
    close: () => ws.close(),
    echoOf: (key) =>
      new Promise((settle, failed) => {
        const from = performance.now()
        const timer = setTimeout(() => {
          waiting.delete(heardIt)
          failed(new Error(`no echo of ${JSON.stringify(key)}`))
        }, 10_000)
        const heardIt = (data) => {
          if (!data.includes(key)) return
          waiting.delete(heardIt)
          clearTimeout(timer)
          settle(performance.now() - from)
        }
        waiting.add(heardIt)
        ws.send(new TextEncoder().encode(key))
      }),
  }
}

async function roundTrips(on, label) {
  const times = []
  for (let at = 0; at < 40; at++) {
    times.push(await on.echoOf('x'))
    await pause(40 + Math.random() * 60)
  }
  times.sort((a, b) => a - b)
  const pick = (share) => times[Math.min(times.length - 1, Math.floor(times.length * share))]
  const ms = (value) => `${value.toFixed(1)} ms`
  log(`echo ${label}: p50 ${ms(pick(0.5))}, p90 ${ms(pick(0.9))}, max ${ms(pick(1))}`)
}

async function main() {
  log('state in', state)
  await until(
    'ordend at ' + ORDEND,
    () =>
      fetch(ORDEND + '/health').then(
        (answer) => answer.ok,
        () => false,
      ),
    120_000,
  )
  mkdirSync(join(ROOT, 'apps/desktop/dist'), { recursive: true })
  writeFileSync(vars, `MACHINE_DEV_ORDEND="${ORDEND}"\nMACHINE_DEV_SECRET="dev"\n`)

  wrangler([
    'd1',
    'migrations',
    'apply',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
  ])
  const hash = createHash('sha256').update(TOKEN).digest('hex')
  const now = Date.now()
  sql("update online_service set value = 'on' where key = 'online'")
  sql(
    `insert into users (id, email, created_at, online) values ('${USER}', 'e2e@nib.test', ${now}, 1);
     insert into sessions (token_hash, user_id, created_at, expires_at, id, name, last_used_at)
       values ('${hash}', '${USER}', ${now}, ${now + 86_400_000}, 'e2e-session', 'e2e', ${now});`,
  )
  log('database ready')

  worker = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--config',
      CONFIG,
      '--local',
      '--enable-containers=false',
      '--ip',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--persist-to',
      state,
      '--env-file',
      vars,
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: SYNC,
      detached: !windows,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  )
  worker.stdout.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`))
  worker.stderr.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`))

  const api = (path, init = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    })
  await until(
    'the Worker',
    () =>
      api('/v2/online/machine').then(
        (answer) => answer.status === 200,
        () => false,
      ),
    120_000,
  )
  log('Worker up')

  const asked = performance.now()
  const made = await api('/v2/online/terms', { method: 'POST', body: '{}' })
  const term = await made.json()
  if (made.status !== 200 || term.v !== 1 || !term.machine || !term.session) {
    throw new Error(`POST /v2/online/terms {} answered ${made.status} ${JSON.stringify(term)}`)
  }
  log('session', term.session, 'on', term.machine, `in ${Math.round(performance.now() - asked)} ms`)

  const first = await socket(term.session)
  await until(
    'the machine awake',
    () => first.heard.frames.some((one) => one.t === 'machine' && one.state === 'awake'),
    60_000,
  )
  await until('the prompt', () => first.heard.at.out !== undefined, 30_000)
  log('connect, ms from the socket made:', JSON.stringify(first.heard.at))
  first.type('echo hi-$((6*7))\r')
  await until('hi-42 printed', () => first.text().includes('hi-42'), 30_000)
  first.typeBytes('echo bytes-$((5*5))\r')
  await until('bytes-25 printed', () => first.text().includes('bytes-25'), 30_000)
  log('typed and answered, as text and as bytes')

  first.type('sleep 3; echo later-$((7*6))\r')
  await pause(500)
  const since = first.end()
  first.close()
  await pause(5000)
  const back = await socket(term.session, since)
  await until('the rest after a reconnect', () => back.text().includes('later-42'), 30_000)
  log('reconnect, ms from the socket made:', JSON.stringify(back.heard.at))
  const resent = back.heard.out.filter((one) => one.seq < since && one.seq + one.length <= since)
  if (back.text().includes('hi-42') || resent.length > 0) {
    throw new Error(
      `a reconnect from ${since} was sent what it drew: ${JSON.stringify(back.heard)}`,
    )
  }
  log('reconnected from', since, 'and got the rest')

  const late = await socket(term.session)
  await until(
    'the late joiner’s screen',
    () => late.heard.frames.some((one) => one.t === 'screen') && late.text().includes('later-42'),
    30_000,
  )
  if (!late.text().includes('hi-42')) throw new Error('the late joiner’s screen is missing hi-42')
  log('late joiner got the screen')

  await roundTrips(back, 'at a quiet prompt')
  back.type('\x15')
  back.type('while :; do printf .; sleep 0.003; done\r')
  await pause(1000)
  await roundTrips(back, 'under steady output')
  back.type('\x03')
  await pause(500)
  late.close()
  back.type("xdg-open 'https://example.com/?from=e2e'; echo opened-$?\r")
  await until(
    'the address opened on the owner’s computer',
    () =>
      back.heard.frames.some(
        (one) => one.t === 'browse' && one.url === 'https://example.com/?from=e2e',
      ),
    30_000,
  )
  log('xdg-open reached the owner’s socket')

  back.type(
    '(cd /tmp && python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 &); sleep 1; echo served-$((1+1))\r',
  )
  await until('a listener on the machine', () => back.text().includes('served-2'), 30_000)
  back.send({ t: 'callback', url: 'http://localhost:8766/?code=e2e' })
  await until(
    'the callback answered',
    () => back.heard.frames.some((one) => one.t === 'called' && one.status === 200),
    30_000,
  )
  log('a sign-in callback was made on the machine')

  back.type('stty -icanon; head -c 200000 > /tmp/big; stty icanon; echo big-$(wc -c < /tmp/big)\r')
  await pause(1000)
  const paste = 'x'.repeat(200_000)
  for (let at = 0; at < paste.length; at += 64 * 1024) back.type(paste.slice(at, at + 64 * 1024))
  await until('the whole paste', () => back.text().includes('big-200000'), 60_000)
  log('a paste of four frames arrived whole')

  back.close()
  late.close()
  log('passed')
}

async function stop() {
  if (worker && worker.exitCode === null) {
    const exited = new Promise((settle) => worker.once('exit', settle))
    if (windows) spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'])
    else process.kill(-worker.pid, 'SIGTERM')
    await Promise.race([exited, pause(10_000)])
  }
  try {
    rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    log('left', state, String(error))
  }
}

let failed = false
try {
  await main()
} catch (error) {
  console.error('[online-e2e] FAILED:', error)
  for (const [at, heard] of opened.entries()) log(`socket ${at} heard`, JSON.stringify(heard))
  failed = true
}
await stop()
process.exit(failed ? 1 : 0)
