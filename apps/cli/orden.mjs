#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const [name, value] of Object.entries(process.env)) {
  const rest = /^NIB_(.+)$/.exec(name)?.[1]
  if (!rest) continue
  process.env[`ORDEN_${rest}`] ??= value
  Reflect.deleteProperty(process.env, name)
}

function endpointFile() {
  if (process.env.ORDEN_ENDPOINT) return process.env.ORDEN_ENDPOINT

  const home = homedir()
  const identifier = 'so.orden.Orden'

  if (platform() === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return join(roaming, identifier, 'automation.json')
  }

  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', identifier, 'automation.json')
  }

  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  return join(config, identifier, 'automation.json')
}

const FLAG = /^--[a-z]/i

function parseArgv(argv) {
  const mine = { json: false, out: null, yes: false, help: false }
  const args = {}
  const rest = []
  let verb = null
  let flags = true

  for (let at = 0; at < argv.length; at++) {
    const word = argv[at]

    if (flags) {
      if (word === '--') {
        flags = false
        continue
      }
      if (word === '--help' || word === '-h') {
        mine.help = true
        continue
      }
      if (word === '--json') {
        mine.json = true
        continue
      }
      if (word === '--yes' || word === '-y') {
        mine.yes = true
        args.yes = true
        continue
      }
      if (word === '--out') {
        mine.out = argv[++at] ?? null
        continue
      }
      if (word.startsWith('--')) {
        const [name, ...value] = word.slice(2).split('=')
        if (value.length) args[name] = value.join('=')
        else if (argv[at + 1] !== undefined && !FLAG.test(argv[at + 1])) args[name] = argv[++at]
        else args[name] = ''
        continue
      }
    }

    if (verb === null) {
      verb = word
      continue
    }

    rest.push(word)
  }

  return { verb, args, rest, ...mine }
}

const USAGE = `orden - drive the running Orden

  orden <verb> [words...] [--name value] [--json] [--yes]

  open <path> [--heading H] [--block B]
  new <name> [--content TEXT] [--append] [--prepend] [--silent]
  append <path> [--content TEXT] [--from FILE|-] [--silent]
  search <query>
  files list
  files read [path]
  files write <path> [--content TEXT] [--from FILE|-] --yes
  files move <path> <to> --yes
  files delete <path> --yes
  links [path]
  backlinks [path]
  orphans
  tags
  properties read [path]
  properties set <key> [value] [--path P] --yes
  outline [path]
  bookmarks
  words [path]
  commands list
  commands run <id>
  sync status
  sync now
  publish status
  publish now
  window
  screenshot [--out FILE]
  tasks list [filter] [--view V]
  tasks add <text> [--note N] [--under H]
  tasks done <at> [--undo]
  base query <path> [--view V]
  react --chat C --message M --emoji E [--on false]
  eval <code> --yes
  verbs

  Every verb takes --space to work in a space other than the one that is open.
  --json answers as JSON rather than as words. Anything that changes a note needs
  --yes, and eval is off until this installation's endpoint file says otherwise.
  nib is the same command.`

async function main() {
  const argv = process.argv.slice(2)
  const asked = parseArgv(argv)

  if (!asked.verb || asked.verb === 'help' || asked.help) {
    return help()
  }

  if (asked.verb === 'screenshot') return screenshot(asked)
  await fromFile(asked)

  const answered = await ask(asked.verb, asked.args, asked.rest)
  return show(answered, asked)
}

async function help() {
  console.log(USAGE)

  const answered = await ask('verbs', {}, []).catch(() => null)
  if (answered?.ok) console.log(`\nthe app answers: ${answered.value.verbs.join(', ')}`)

  return 0
}

async function fromFile(asked) {
  const from = asked.args.from
  if (from === undefined) return

  delete asked.args.from
  asked.args.content = from === '-' ? await readStdin() : await readFile(from, 'utf8')
}

function readStdin() {
  return new Promise((settle, fail) => {
    let held = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (held += chunk))
    process.stdin.on('end', () => settle(held))
    process.stdin.on('error', fail)
  })
}

async function ask(verb, args, rest) {
  const { port, secret } = await endpoint()

  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ verb, args, rest }),
  }).catch((error) => {
    throw new Error(`Orden is not answering on 127.0.0.1:${port}: ${error.message}`)
  })

  const said = await response.text()
  const body = said ? JSON.parse(said) : {}

  if (!response.ok) throw new Error(body.error ?? `the app answered ${response.status}`)
  return body
}

async function endpoint() {
  const path = endpointFile()
  const held = await readFile(path, 'utf8').catch(() => null)
  if (held === null) {
    throw new Error(
      `no endpoint file at ${path}: open Orden once, and note that the browser build has no command line`,
    )
  }

  const { port, secret, pid } = JSON.parse(held)
  if (!port || !secret) throw new Error(`${path} says no port or no secret`)

  return { port, secret, pid }
}

async function screenshot(asked) {
  const out = asked.out ?? join(tmpdir(), 'orden-window.png')
  const rect = await ask('window', {}, [])
  if (!rect.ok) return show(rect, asked)

  const byPid = platform() === 'win32' || platform() === 'darwin'
  const { pid } = byPid ? await endpoint() : {}
  if (byPid && !pid)
    throw new Error('this app did not say which process it is, so it cannot be photographed')

  if (platform() === 'win32') {
    const script = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../scripts/capture-window.ps1',
    )
    const ran = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Out',
        out,
        '-Pid',
        String(pid),
      ],
      { encoding: 'utf8' },
    )
    if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'the capture failed')
  } else if (platform() === 'darwin') {
    const id = macWindow(pid, rect.value)
    const ran = spawnSync('screencapture', ['-x', '-o', `-l${id}`, out], { encoding: 'utf8' })
    if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'the capture failed')
  } else {
    throw new Error(
      'no screenshot on this platform: X11 and Wayland share no capture tool, so take one yourself',
    )
  }

  return show({ ok: true, value: { file: out, ...rect.value } }, asked)
}

const MAC_WINDOWS = `ObjC.import('CoreGraphics')
function run(argv) {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)))
  return JSON.stringify(all.filter((one) => one.kCGWindowOwnerPID === Number(argv[0]) && one.kCGWindowLayer === 0)
    .map((one) => ({ id: one.kCGWindowNumber, ...one.kCGWindowBounds })))
}`

function macWindow(pid, { x, y, width, height, scale }) {
  const ran = spawnSync('osascript', ['-l', 'JavaScript', '-e', MAC_WINDOWS, String(pid)], {
    encoding: 'utf8',
  })
  if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'could not list the windows')

  const near = (a, b) => Math.abs(a - b / scale) <= 1
  const found = JSON.parse(ran.stdout).find(
    (one) => near(one.X, x) && near(one.Y, y) && near(one.Width, width) && near(one.Height, height),
  )
  if (!found) throw new Error(`process ${pid} has no window on screen where the app said it is`)

  return found.id
}

function show(answered, asked) {
  if (asked.json) {
    console.log(JSON.stringify(answered, null, 2))
    return answered.ok ? 0 : 1
  }

  if (!answered.ok) {
    console.error(answered.error)
    return 1
  }

  const value = answered.value
  if (value === null || typeof value !== 'object') {
    console.log(String(value))
    return 0
  }

  for (const [name, held] of Object.entries(value)) {
    if (Array.isArray(held)) {
      for (const one of held) console.log(asLine(one))
      continue
    }
    if (held !== null && typeof held === 'object') {
      console.log(`${name}: ${JSON.stringify(held)}`)
      continue
    }

    console.log(`${name}: ${String(held)}`)
  }

  return 0
}

function asLine(one) {
  if (one === null || typeof one !== 'object') return String(one)

  return Object.values(one)
    .filter((held) => held === null || typeof held !== 'object')
    .map((held) => String(held))
    .join('\t')
}

main()
  .then((code) => {
    process.exitCode = code ?? 0
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
