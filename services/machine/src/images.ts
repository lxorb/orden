import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ImageKind, isImageId, MOST_IMAGE } from '@orden/online/wire'
import { asUser, SETPRIV, type User } from './limits'

const MOST_COMING = 4
const STALLED = 60_000
const KEPT = 24 * 60 * 60_000
const WRITE_WITHIN = 15_000

const ENDS: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

export const NAMED = /^[a-z0-9]{16,64}\.(png|jpg|gif|webp)$/

export const AS_USER_SCRIPT = [
  'umask 077',
  'd="$HOME/.cache/nib/images"',
  'mkdir -p "$d" || exit 1',
  `find "$d" -maxdepth 1 -type f -mmin +${String(KEPT / 60_000)} -regextype posix-extended -regex '.*/[a-z0-9]{16,64}\\.(png|jpg|gif|webp)' -delete 2>/dev/null`,
  'set -C',
  'cat > "$d/$1" || exit 1',
  'printf %s "$d/$1"',
].join('\n')

export type Run = (
  file: string,
  args: string[],
  env: Record<string, string>,
  input: Uint8Array,
) => Promise<{ code: number | null; out: string }>

export const runChild: Run = (file, args, env, input) =>
  new Promise((settle) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'ignore'] })
    const out: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), WRITE_WITHIN)
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      settle({ code: null, out: '' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      settle({ code, out: Buffer.concat(out).toString() })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

interface Coming {
  kind: ImageKind
  parts: Uint8Array[]
  size: number
  at: number
}

export interface Options {
  now?: () => number
  run?: Run
  has?: (path: string) => boolean
}

export class Images {
  private readonly coming = new Map<string, Coming>()
  private readonly now: () => number
  private readonly run: Run
  private readonly has: (path: string) => boolean

  constructor(
    private readonly home: string,
    private readonly user: User | null,
    options: Options = {},
  ) {
    this.now = options.now ?? Date.now
    this.run = options.run ?? runChild
    this.has = options.has ?? existsSync
  }

  async part(
    id: string,
    kind: ImageKind,
    data: Uint8Array,
    last: boolean,
  ): Promise<string | null | undefined> {
    if (!isImageId(id)) return null
    const now = this.now()
    this.forgetStalled(now)

    let coming = this.coming.get(id)
    if (!coming) {
      if (this.coming.size >= MOST_COMING) {
        const oldest = this.coming.keys().next().value
        if (oldest !== undefined) this.coming.delete(oldest)
      }
      coming = { kind, parts: [], size: 0, at: now }
      this.coming.set(id, coming)
    }
    coming.parts.push(data)
    coming.size += data.length
    coming.at = now

    if (coming.size > MOST_IMAGE) {
      this.coming.delete(id)
      return null
    }
    if (!last) return undefined

    this.coming.delete(id)
    const name = `${id}.${ENDS[coming.kind]}`
    const bytes = Buffer.concat(coming.parts)
    try {
      return this.user ? await this.writtenAs(this.user, name, bytes) : this.written(name, bytes)
    } catch {
      return null
    }
  }

  private async writtenAs(user: User, name: string, bytes: Uint8Array): Promise<string | null> {
    if (!this.has(SETPRIV)) return null
    const command = asUser(user, ['/bin/sh', '-c', AS_USER_SCRIPT, 'orden-image', name])
    const [file = SETPRIV, ...args] = command
    const env = { HOME: user.home, PATH: '/usr/local/bin:/usr/bin:/bin' }
    const { code, out } = await this.run(file, args, env, bytes)
    const path = join(user.home, '.cache', 'nib', 'images', name)
    return code === 0 && out === path ? path : null
  }

  private written(name: string, bytes: Uint8Array): string {
    const folder = join(this.home, '.cache', 'nib', 'images')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    this.clear(folder)
    const path = join(folder, name)
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
    return path
  }

  private clear(folder: string): void {
    const before = this.now() - KEPT
    for (const name of readdirSync(folder)) {
      if (!NAMED.test(name)) continue
      const path = join(folder, name)
      try {
        const stat = lstatSync(path)
        if (stat.isFile() && stat.mtimeMs < before) rmSync(path, { force: true })
      } catch {
        // Gone already: the next picture tries again.
      }
    }
  }

  private forgetStalled(now: number): void {
    for (const [id, coming] of this.coming) {
      if (now - coming.at > STALLED) this.coming.delete(id)
    }
  }
}
