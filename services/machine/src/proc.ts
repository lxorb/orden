import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { basename } from 'node:path'

function statOf(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  } catch {
    return null
  }
}

function field(pid: number, at: number): number | null {
  const value = Number(statOf(pid)?.[at])
  return Number.isSafeInteger(value) ? value : null
}

function frontOf(shell: number): number | null {
  const front = field(shell, 5)
  return front !== null && front > 0 ? front : null
}

const RUNNERS = new Set(['node', 'nodejs'])

function nameOf(pid: number): string | null {
  try {
    const comm = readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim()
    if (!RUNNERS.has(comm)) return comm || null
    const script = readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8').split('\0')[1]
    if (!script || script.startsWith('-')) return comm
    return basename(script).replace(/\.[cm]?js$/, '') || comm
  } catch {
    return null
  }
}

export function programOf(shell: number): string | null {
  const front = frontOf(shell)
  if (front === null || front === shell) return null
  return nameOf(front)
}

export function folderOf(shell: number): string | null {
  try {
    return readlinkSync(`/proc/${String(shell)}/cwd`)
  } catch {
    return null
  }
}

export function sessionProcesses(shell: number): number[] {
  return sessionStates(shell).map(([pid]) => pid)
}

export function sessionStates(shell: number): [pid: number, state: string][] {
  let pids: string[]
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return []
  }
  const found: [number, string][] = []
  for (const pid of pids.map(Number)) {
    const stat = statOf(pid)
    if (stat && Number(stat[3]) === shell) found.push([pid, stat[0] ?? '?'])
  }
  return found
}
