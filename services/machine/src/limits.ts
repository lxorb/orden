import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sessionStates } from './proc'

export const PIDS_MAX = 4096

const KEPT_FOR_NIBD = 512 * 1024 * 1024

export function memoryMax(meminfo: string): number | null {
  const kib = Number(/^MemTotal:\s+(\d+) kB$/m.exec(meminfo)?.[1])
  if (!Number.isSafeInteger(kib) || kib <= 0) return null
  const most = kib * 1024 - KEPT_FOR_NIBD
  return most >= KEPT_FOR_NIBD ? most : null
}

export interface User {
  name: string
  uid: number
  gid: number
  home: string
  shell: string
}

export function userOf(name: string, passwd = '/etc/passwd'): User | null {
  let lines: string[]
  try {
    lines = readFileSync(passwd, 'utf8').split('\n')
  } catch {
    return null
  }
  for (const line of lines) {
    const [user, , uid, gid, , home, shell] = line.split(':')
    if (user !== name || !home || !shell) continue
    return { name, uid: Number(uid), gid: Number(gid), home, shell }
  }
  return null
}

const PRLIMIT = '/usr/bin/prlimit'
export const SETPRIV = '/usr/bin/setpriv'

export function asUser(user: User, command: string[]): string[] {
  return [
    SETPRIV,
    `--reuid=${String(user.uid)}`,
    `--regid=${String(user.gid)}`,
    '--init-groups',
    '--',
    ...command,
  ]
}

export function shellCommand(
  shell: string,
  user: User | null,
  pidsMax: number,
  has: (path: string) => boolean = existsSync,
): { file: string; args: string[] } {
  let command = [shell, '-l']
  if (has(PRLIMIT)) {
    const fence = `${PRLIMIT} --nproc=${String(pidsMax)} --pid $$ 2>/dev/null; exec "$@"`
    command = ['/bin/sh', '-c', fence, 'orden-shell', ...command]
  }
  if (user && has(SETPRIV)) command = asUser(user, command)
  const [file = shell, ...args] = command
  return { file, args }
}

export class Cgroups {
  private readonly base: string

  private constructor(base: string) {
    this.base = base
  }

  static open(pidsMax: number, root = '/sys/fs/cgroup'): Cgroups | null {
    if (!existsSync(join(root, 'cgroup.controllers'))) return null
    const base = join(root, 'nibd')
    try {
      mkdirSync(base, { recursive: true })
      enable(root, '+pids')
      appendFileSync(join(base, 'cgroup.subtree_control'), '+pids')
      writeFileSync(join(base, 'pids.max'), String(pidsMax))
      fenceMemory(root, base)
      return new Cgroups(base)
    } catch {
      return null
    }
  }

  dirOf(session: string): string {
    return join(this.base, session)
  }

  kill(session: string): boolean {
    const dir = join(this.base, session)
    try {
      writeFileSync(join(dir, 'cgroup.kill'), '1')
    } catch {
      return false
    }
    setTimeout(() => {
      try {
        rmdirSync(dir)
      } catch {
        // Still emptying, or gone: the next boot starts from a fresh filesystem.
      }
    }, 500).unref()
    return true
  }
}

export function enterCgroup(dir: string, pid: number): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cgroup.procs'), String(pid))
    return true
  } catch {
    return false
  }
}

function fenceMemory(root: string, base: string): void {
  try {
    const most = memoryMax(readFileSync('/proc/meminfo', 'utf8'))
    if (most === null) return
    enable(root, '+memory')
    writeFileSync(join(base, 'memory.max'), String(most))
  } catch {
    // No memory controller here: the machine's own limit is the only one.
  }
}

function enable(root: string, controller: string): void {
  try {
    appendFileSync(join(root, 'cgroup.subtree_control'), controller)
    return
  } catch {
    // EBUSY: processes in the root. Move them and try again.
  }
  const daemon = join(root, 'daemon')
  mkdirSync(daemon, { recursive: true })
  for (const pid of readFileSync(join(root, 'cgroup.procs'), 'utf8').split('\n')) {
    if (!pid) continue
    try {
      writeFileSync(join(daemon, 'cgroup.procs'), pid)
    } catch {
      // A kernel thread, or gone.
    }
  }
  appendFileSync(join(root, 'cgroup.subtree_control'), controller)
}

export function killSession(shell: number): void {
  const until = Date.now() + 5000
  let still = 0
  while (still < 2 && Date.now() < until) {
    const moving = sessionStates(shell).filter(([, state]) => !SETTLED.has(state))
    still = moving.length === 0 ? still + 1 : 0
    signal(moving, 'SIGSTOP')
  }
  const alive = () => sessionStates(shell).filter(([, state]) => !DEAD.has(state))
  if (still === 2) {
    signal(alive(), 'SIGKILL')
    return
  }
  const later = Date.now() + 5000
  for (let left = alive(); left.length > 0 && Date.now() < later; left = alive()) {
    signal(left, 'SIGKILL')
  }
}

const SETTLED = new Set(['T', 't', 'Z', 'X'])
const DEAD = new Set(['Z', 'X'])

function signal(processes: [pid: number, state: string][], name: NodeJS.Signals): void {
  for (const [pid] of processes) {
    try {
      process.kill(pid, name)
    } catch {
      // Already gone.
    }
  }
}
