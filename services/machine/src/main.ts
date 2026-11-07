import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { Cgroups, PIDS_MAX, userOf } from './limits'
import { Ordend } from './ordend'
import { listenOpener, OPEN_SOCKET, serveOpener } from './opener'
import { serve } from './server'
import { watch } from './watchdog'

const PORT = 7680
const RESTART = 75

const PASSED = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'GIT_SSL_CAINFO',
]

function numberOf(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return value && Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function said(name: string): string | undefined {
  return process.env[`ORDEND_${name}`] ?? process.env[`NIBD_${name}`]
}

function main(): void {
  const env = process.env
  const secret = said('SECRET') ?? ''
  delete env.ORDEND_SECRET
  delete env.NIBD_SECRET
  const former = !existsSync('/opt/ordend') && existsSync('/opt/nibd')

  const root = process.getuid?.() === 0
  const user = root ? userOf(said('USER') ?? 'nib') : null
  const home = user?.home ?? homedir()
  const shell = user?.shell ?? env.SHELL ?? (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')
  const name = user?.name ?? userInfo().username
  const pidsMax = numberOf(said('PIDS_MAX'), PIDS_MAX)

  const sessionEnv: Record<string, string> = {
    HOME: home,
    USER: name,
    LOGNAME: name,
    SHELL: shell,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'orden',
    LANG: 'C.UTF-8',
    BROWSER: 'orden-open',
  }
  for (const key of PASSED) {
    const value = env[key]
    if (value) sessionEnv[key] = value
  }

  const ordend = new Ordend({
    state: said('STATE') ?? (former ? '/var/lib/nibd' : '/var/lib/ordend'),
    home,
    shell,
    user,
    env: sessionEnv,
    pidsMax,
    cgroups: root ? Cgroups.open(pidsMax) : null,
    activityEvery: numberOf(said('ACTIVITY_MS'), 30_000),
    homeEvery: numberOf(said('HOME_MS'), 60 * 60_000),
    saveEvery: numberOf(said('SAVE_MS'), 5 * 60_000),
    holder: join(dirname(process.argv[1] ?? '.'), 'hold.cjs'),
    restart: () => {
      ordend.stop()
      process.exit(RESTART)
    },
  })
  watch()

  const server = serve(ordend, secret)
  server.listen(numberOf(said('PORT'), PORT), said('HOST') ?? '0.0.0.0')
  listenOpener(
    serveOpener({ open: (url, session) => ordend.open(url, session) }),
    said('OPEN') ?? (former ? '/run/nibd/open.sock' : OPEN_SOCKET),
  )

  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    setTimeout(() => process.exit(0), 8000).unref()
    void ordend.saveAll().finally(() => {
      ordend.stop()
      process.exit(0)
    })
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main()
