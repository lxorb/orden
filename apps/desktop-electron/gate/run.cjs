const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const out = process.env.GATE_OUT || path.join(root, 'out')
const exe = process.env.GATE_EXE || require('electron')
const args = [...(process.platform === 'linux' && !process.env.GATE_SANDBOX ? ['--no-sandbox'] : []), ...(process.env.GATE_EXE ? [] : [root])]
const only = (process.env.GATE_ONLY || '').split(',').filter(Boolean)
const PLAN = [
  ['resize', ['webview', 'view'], 3],
  ['layers', ['webview'], 1],
  ['keys', ['webview'], 1],
  ['ime', ['webview'], 1],
  ['dnd', ['webview'], 1],
  ['video', ['webview', 'view'], 1],
  ['scroll', ['webview', 'view'], 3],
  ['idle', ['webview', 'view'], 1],
  ['memory', ['webview', 'view'], 1],
  ['persist', ['webview'], 1],
  ['ext', ['webview'], 1],
  ['startup', ['webview'], 5],
]
fs.mkdirSync(out, { recursive: true })
const all = []
function run(check, mode, extra = {}) {
  const userData = extra.GATE_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'orden-gate-'))
  const env = { ...process.env, GATE_CHECK: check, GATE_MODE: mode, GATE_OUT: out, GATE_USERDATA: userData, GATE_STARTED: String(Date.now()), ...extra }
  const file = path.join(out, `${check}-${mode}${extra.GATE_PHASE === '2' ? '-2' : ''}.json`)
  fs.rmSync(file, { force: true })
  const got = spawnSync(exe, args, { env, encoding: 'utf8', timeout: 300000 })
  let body = { check, mode, pass: false, data: { error: `no result, exit ${got.status} ${got.signal || ''}`, stderr: (got.stderr || '').slice(-1500) } }
  if (fs.existsSync(file)) body = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!extra.keep) fs.rmSync(userData, { recursive: true, force: true })
  return body
}
for (const [check, modes, rounds] of PLAN) {
  if (only.length && !only.includes(check)) continue
  for (const mode of modes) {
    for (let round = 1; round <= rounds; round++) {
      let body
      if (check === 'persist') {
        const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orden-gate-'))
        const GATE_PORT = String(20000 + Math.floor(Math.random() * 20000))
        const first = run(check, mode, { GATE_USERDATA: userData, GATE_PHASE: '1', GATE_PORT, keep: true })
        body = run(check, mode, { GATE_USERDATA: userData, GATE_PHASE: '2', GATE_PORT })
        body.data = { ...body.data, first: first.data }
        body.pass = body.pass && first.pass
      } else body = run(check, mode)
      body.round = round
      all.push(body)
      console.log(`${body.pass ? 'PASS' : 'FAIL'} ${check} ${mode} #${round} ${JSON.stringify(body.data).slice(0, 600)}`)
    }
  }
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(all, null, 1))
const failed = all.filter((b) => !b.pass)
console.log(`GATE ${failed.length ? 'FAIL' : 'PASS'}: ${all.length - failed.length}/${all.length}${failed.length ? ' failed: ' + failed.map((b) => `${b.check}/${b.mode}`).join(', ') : ''}`)
