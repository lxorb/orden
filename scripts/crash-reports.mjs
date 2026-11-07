import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABELS = {
  panic: 'Panic',
  crash: 'Crash',
  freeze: 'Freeze',
  engine: 'Engine',
  js: 'JS error',
  exit: 'Hard exit',
}

const MOST_BODY = 60_000
const LOG_TAIL = 60
const OTHER_FRAMES = 8

const USAGE = `usage: node scripts/crash-reports.mjs <command>
  groups [--since <days>] [--limit <n>]   the groups, latest first
  list <signature> [--limit <n>]          the reports of a group
  read <id>                               one whole report
  file <signature> [--repo lxorb/orden] [--symbols <nib.pdb or debug file>]
                                          open a GitHub issue for a group
env: ORDEN_CRASH_TOKEN (required), ORDEN_API (default https://orden.so)`

export function issueTitle(group) {
  return `${LABELS[group.kind] ?? 'Crash'}: ${group.title}`.slice(0, 250)
}

export function fenced(text, language = 'text') {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${text}\n${fence}`
}

function stamp(at) {
  return new Date(at)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z')
}

export function chosenThread(threads) {
  if (!threads?.length) return undefined
  return threads.find((one) => one.crashed) ?? threads.find((one) => one.main) ?? threads[0]
}

function frameLine(frame, index, symbols) {
  const named = frame.symbol ? `${frame.module}!${frame.symbol}` : `${frame.module}+${frame.offset}`
  const found = symbols?.get(`${frame.module}+${frame.offset}`)
  const resolved = found ? `  ${found.symbol}${found.location ? ` (${found.location})` : ''}` : ''
  return `#${String(index).padStart(2, '0')} ${named}${resolved}`
}

function threadText(thread, most, symbols) {
  const marks = [thread.crashed ? 'crashed' : null, thread.main ? 'main' : null].filter(Boolean)
  const head = `thread "${thread.name}"${marks.length ? ` (${marks.join(', ')})` : ''}`
  const frames = thread.frames
    .slice(0, most)
    .map((frame, index) => frameLine(frame, index, symbols))
  const more = thread.frames.length > most ? [`   … ${thread.frames.length - most} more`] : []
  return [head, ...frames, ...more].join('\n')
}

export function stackText(report, symbols) {
  const chosen = chosenThread(report.threads)
  if (!chosen) return report.stack ?? ''
  const others = report.threads.filter((one) => one !== chosen)
  return [
    threadText(chosen, Infinity, symbols),
    ...others.map((one) => threadText(one, OTHER_FRAMES, symbols)),
  ].join('\n\n')
}

function facts(report) {
  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
  const lines = [
    ['Kind', report.kind],
    ['Summary', report.summary],
    ['App', `${report.app.version} (${report.app.channel}, ${report.app.build})`],
    [
      'System',
      `${report.system.os} ${report.system.osVersion} ${report.system.arch}, ${report.system.engine}`,
    ],
    ['Where', report.where],
    ['Doing', report.doing],
    ['Held', report.held === undefined ? undefined : seconds(report.held)],
    ['Killed', report.killed === undefined ? undefined : String(report.killed)],
    ['Process', report.process],
    ['Reason', report.reason],
    [
      'Open',
      report.open
        ? `${report.open.windows} windows; ${Object.entries(report.open.kinds)
            .map(([kind, many]) => `${kind} ${many}`)
            .join(', ')}`
        : undefined,
    ],
    [
      'Resources',
      report.resources
        ? Object.entries(report.resources)
            .map(([name, value]) => `${name} ${value}`)
            .join(', ')
        : undefined,
    ],
    ['At', stamp(report.at)],
  ]
  return lines
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

export function issueBody(group, id, report, symbols) {
  const parts = [
    `**${group.count} report${group.count === 1 ? '' : 's'}** from ${stamp(group.firstAt)} to ${stamp(group.lastAt)}`,
    `Versions: ${group.versions.join(', ') || 'unknown'}`,
    `Platforms: ${group.platforms.join(', ') || 'unknown'}`,
    `Group: \`${group.signature}\` · representative report: \`${id}\``,
    '### Report',
    fenced(facts(report)),
  ]
  const stack = stackText(report, symbols)
  if (stack) parts.push('### Stack', fenced(stack))
  if (report.breadcrumbs?.length) {
    const crumbs = report.breadcrumbs.map((crumb) => `${stamp(crumb.at)}  ${crumb.what}`)
    parts.push('### Breadcrumbs', fenced(crumbs.join('\n')))
  }
  if (report.log?.length) {
    parts.push(
      `### Log (last ${Math.min(LOG_TAIL, report.log.length)} lines)`,
      fenced(report.log.slice(-LOG_TAIL).join('\n')),
    )
  }
  const body = parts.join('\n\n')
  return body.length > MOST_BODY ? `${body.slice(0, MOST_BODY)}\n\n… cut` : body
}

export function parseSymbolized(output) {
  return output
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block) => {
      const [name = '??', place = ''] = block.trim().split('\n')
      const symbol = name.trim()
      const location = place.trim()
      if (symbol === '??' || !symbol) return null
      return { symbol, location: /^\?\?(:0)*$/.test(location) ? '' : location }
    })
}

function stemOf(path) {
  return basename(path)
    .toLowerCase()
    .replace(/\.(pdb|debug|dbg|exe|dll|so|dylib)$/, '')
}

export function framesToSymbolize(report, symbolsFile) {
  const stem = stemOf(symbolsFile)
  const ours = new Set([stem, 'nib', 'orden', 'libnib_lib', 'orden_lib', 'liborden_lib', 'nib_lib'])
  const wanted = new Map()
  for (const thread of report.threads ?? []) {
    for (const frame of thread.frames) {
      if (frame.symbol || !ours.has(stemOf(frame.module))) continue
      if (!/^0x[0-9a-f]+$/i.test(frame.offset)) continue
      wanted.set(`${frame.module}+${frame.offset}`, frame.offset)
    }
  }
  return wanted
}

function symbolize(report, symbolsFile) {
  const wanted = framesToSymbolize(report, symbolsFile)
  if (!wanted.size) return undefined
  const offsets = [...wanted.values()]
  const relative = /\.(pdb|exe|dll)$/i.test(symbolsFile) ? ['--relative-address'] : []
  const ran = spawnSync('llvm-symbolizer', [`--obj=${symbolsFile}`, ...relative, ...offsets], {
    encoding: 'utf8',
  })
  if (ran.error || ran.status !== 0) {
    console.error(
      `llvm-symbolizer did not run (${ran.error?.message ?? ran.stderr.trim()}); filing without symbols`,
    )
    return undefined
  }
  const found = parseSymbolized(ran.stdout)
  const symbols = new Map()
  ;[...wanted.keys()].forEach((key, index) => {
    const one = found[index]
    if (one) symbols.set(key, one)
  })
  return symbols
}

function optionOf(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

async function api(path, init = {}) {
  const token = process.env.ORDEN_CRASH_TOKEN
  if (!token) throw new Error('set ORDEN_CRASH_TOKEN')
  const base = (process.env.ORDEN_API ?? 'https://orden.so').replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  const text = await response.text()
  if (response.status === 404) throw new Error(`${path}: not found (or the token is not right)`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

async function groups(args) {
  const days = Number(optionOf(args, '--since') ?? '30')
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const limit = optionOf(args, '--limit') ?? '50'
  const listed = await api(`/v1/crashes/groups?since=${since}&limit=${limit}`)
  for (const group of listed.groups) {
    const issue = group.issue ? ` #${group.issue.number}` : ''
    console.log(
      `${String(group.count).padStart(5)}  ${group.signature}  ${stamp(group.lastAt)}  ${issueTitle(group)}${issue}`,
    )
    console.log(`       ${group.versions.join(', ') || '-'} · ${group.platforms.join(', ') || '-'}`)
  }
  if (!listed.groups.length) console.log('no crash reports')
}

async function list(args) {
  const signature = args[0]
  if (!signature) throw new Error(USAGE)
  const limit = optionOf(args, '--limit') ?? '50'
  const listed = await api(
    `/v1/crashes?group=${encodeURIComponent(signature)}&limit=${encodeURIComponent(limit)}`,
  )
  for (const one of listed.reports) {
    console.log(`${one.id}  ${stamp(one.receivedAt)}  ${one.kind}  ${one.version}  ${one.platform}`)
  }
}

async function read(args) {
  const id = args[0]
  if (!id) throw new Error(USAGE)
  console.log(JSON.stringify(await api(`/v1/crashes/${encodeURIComponent(id)}`), null, 2))
}

async function representative(signature) {
  const listed = await api(`/v1/crashes?group=${encodeURIComponent(signature)}&limit=50`)
  for (const one of listed.reports) {
    const whole = await api(`/v1/crashes/${one.id}`)
    if (whole.report) return whole
  }
  throw new Error(`group ${signature} has no report left to show`)
}

async function file(args) {
  const signature = args[0]
  if (!signature) throw new Error(USAGE)
  const repo = optionOf(args, '--repo') ?? 'lxorb/orden'
  const symbolsFile = optionOf(args, '--symbols')

  const whole = await representative(signature)
  const group = whole.group
  if (group.issue) {
    console.log(`already filed as #${group.issue.number}: ${group.issue.url}`)
    return
  }

  const symbols = symbolsFile ? symbolize(whole.report, symbolsFile) : undefined
  const made = spawnSync(
    'gh',
    ['issue', 'create', '--repo', repo, '--title', issueTitle(group), '--body-file', '-'],
    { encoding: 'utf8', input: issueBody(group, whole.id, whole.report, symbols) },
  )
  if (made.error || made.status !== 0) {
    throw new Error(`gh issue create failed: ${made.error?.message ?? made.stderr.trim()}`)
  }
  const url = made.stdout.trim().split('\n').pop() ?? ''
  const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1])
  if (!number) throw new Error(`gh gave no issue address: ${made.stdout}`)

  await api(`/v1/crashes/groups/${encodeURIComponent(signature)}/issue`, {
    method: 'POST',
    body: JSON.stringify({ number, url }),
  })
  console.log(`filed #${number}: ${url}`)
}

const COMMANDS = { groups, list, read, file }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  const run = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : undefined
  if (!run) {
    console.error(USAGE)
    process.exit(1)
  }
  run(args).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
