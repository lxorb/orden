#!/usr/bin/env node
/** `orden`, and `nib` under the name it had before: the running app, from a terminal.
 *
 *  What it is, in one line: a request to the socket the app opened on 127.0.0.1,
 *  with the secret out of the app's own config folder, and whatever the app said
 *  printed back. Every verb happens inside the app - the same call the palette, a
 *  key or a click would make - so a note this writes is a note that appears on
 *  screen, is undoable and syncs. The whole of what the verbs are lives in the
 *  app; see apps/desktop/src/lib/automation/verbs.ts.
 *
 *  What is deliberately not here: any knowledge of what a verb does. This script
 *  turns words into `{ verb, args, rest }`, sends it, and prints. That is why it
 *  can stay this short, and why it cannot come to a different answer from the app
 *  about anything. `orden help` asks the app for the list of verbs, so even the help
 *  is the app's answer rather than a second copy of it.
 *
 *  Where it ships: nowhere, on purpose, and that is the lightest thing it could be.
 *  A sidecar would be a second compiled binary in every installer on every platform
 *  for something almost nobody runs, and a sidecar is the only way an installer can
 *  ship a command at all. Node is already this repository's answer for driving nib
 *  without the app - see scripts/nib-sync.mjs - so this is a Node script beside it.
 *  Run it as `node apps/cli/nib.mjs ...`, or put it on the path with
 *  `pnpm --filter @nib/cli link --global`.
 *
 *  There is no browser build of this and there never will be: a tab has no socket
 *  to listen on. `orden` against the web app says so rather than failing to connect.
 *
 *  Usage, and the security notes: docs/automation.md. */

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the app writes the port and the secret, per platform. The same folder
 *  Tauri's own `app_config_dir` answers with for this identifier; see
 *  src-tauri/src/endpoint.rs. */
function endpointFile() {
  if (process.env.NIB_ENDPOINT) return process.env.NIB_ENDPOINT

  const home = homedir()
  const identifier = 'ch.emilvinu.nib'

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

/** The words a caller typed, as something to send.
 *
 *  `orden files read notes/plan.md --json` becomes the verb `files`, the rest
 *  `['read', 'notes/plan.md']` and the flag `json`, which is this script's rather
 *  than the app's. The app joins the first two into `files.read` itself, because
 *  the app is the one that knows which verbs are written as two words; see
 *  `dispatch` in the automation folder.
 *
 *  `--name value` is a named argument; `--name` on its own is a yes, the same way a
 *  query string writes one. A value may start with dashes - a note's front matter
 *  opens with `---` - so only a word that reads as a flag ends one.
 *
 *  `--help` and `-h` ask for the help only where a flag goes: the value of a flag is
 *  that value, so `orden append log.md --content -h` appends `-h`. And a bare `--` is
 *  the end of the flags, as everywhere else on a command line: every word after it is
 *  a word, whatever it starts with. */
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

/** What `orden --help` prints when the app is not there to answer. Short on purpose:
 *  the reference is docs/automation.md, and the list of verbs is the app's. */
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
  nib is the same command. See docs/automation.md.`

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

/** The help, with the app's own list of verbs under it when the app is running. */
async function help() {
  console.log(USAGE)

  const answered = await ask('verbs', {}, []).catch(() => null)
  if (answered?.ok) console.log(`\nthe app answers: ${answered.value.verbs.join(', ')}`)

  return 0
}

/** `files write --from FILE`, or `--from -` for what is on the standard input, so
 *  a note does not have to be a shell argument. */
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

/** One request to the app. */
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

  // The process that wrote this file is the process listening on that port, which is
  // what `screenshot` needs: two nibs can be running and only one of them answered.
  return { port, secret, pid }
}

/** A picture of the window.
 *
 *  The app says where its window is; the picture is taken by the platform, because
 *  a webview cannot photograph the window it is drawn in.
 *
 *  Windows is handed the pid the app wrote beside its port, so the window in the picture
 *  is the window of the app that answered - two nibs can be running, and going by name
 *  photographed whichever Windows listed first. The script asks that window to draw
 *  itself rather than copying the screen, so nothing in front of it lands in the file,
 *  and it raises nothing: a screenshot must not take the keyboard off whatever somebody
 *  is typing in.
 *
 *  macOS is handed the same pid, and `screencapture -l` the number of that process's
 *  window, which it draws on its own: copying the rectangle off the screen put whatever
 *  was in front of the window into the picture, a system dialog or another app's
 *  window over a corner. Linux is told the truth: X11 and Wayland have no one tool
 *  between them, so there is nothing honest to shell out to. */
async function screenshot(asked) {
  const out = asked.out ?? join(tmpdir(), 'nib-window.png')
  const rect = await ask('window', {}, [])
  if (!rect.ok) return show(rect, asked)

  // A pid or nothing. The window is found by pid and never by name, because a name once
  // matched another application's window entirely; an endpoint file with no pid in it
  // is an app too old to say which window is its own.
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
    // `-o` leaves the shadow out, so the picture is the window's own size.
    const ran = spawnSync('screencapture', ['-x', '-o', `-l${id}`, out], { encoding: 'utf8' })
    if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'the capture failed')
  } else {
    throw new Error(
      'no screenshot on this platform: X11 and Wayland share no capture tool, so take one yourself',
    )
  }

  return show({ ok: true, value: { file: out, ...rect.value } }, asked)
}

/** The window server's number for the window of `pid` that is where the app said its
 *  window is, in points: the process has a few windows nobody sees besides the one it
 *  draws in. Asked of CoreGraphics through JavaScript for Automation, which every Mac
 *  has, so the command line still needs nothing installed. */
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

/** What the app said, printed.
 *
 *  `--json` is the whole answer as it came. Without it the answer is read for the
 *  shape it has: a list of things becomes a line each, and anything else becomes
 *  its own fields, because a wall of JSON is not an answer to a person. */
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

/** One row of a list, as a line. A string is itself; anything else is its values
 *  with tabs between them, which is what a shell can cut on. */
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
