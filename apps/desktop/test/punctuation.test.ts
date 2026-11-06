import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const SKIP = '.claude/'
const NOT_OURS = [
  'apps/desktop/src-tauri/linux/tauri-runtime-cef/',
  'apps/desktop/src-tauri/windows/wry/',
]
const EXTENSIONS = ['.ts', '.svelte', '.rs', '.css', '.json', '.jsonc', '.md', '.mjs', '.yml']

const ALLOWED = ['packages/editor/src/typography.ts', 'packages/editor/src/typography.test.ts']

const EM_DASH = String.fromCharCode(0x2014)

function sources(): string[] {
  const listed = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  return listed
    .split('\0')
    .filter(
      (path) => path && !path.startsWith(SKIP) && !NOT_OURS.some((one) => path.startsWith(one)),
    )
    .filter((path) => EXTENSIONS.some((extension) => path.endsWith(extension)))
    .filter((path) => existsSync(join(ROOT, path)))
}

describe('the app writes without em dashes', () => {
  test('nothing outside smart punctuation uses one', () => {
    const offenders: string[] = []

    for (const relative of sources()) {
      if (ALLOWED.includes(relative)) continue

      const text = readFileSync(join(ROOT, relative), 'utf8')
      if (text.includes(EM_DASH)) {
        const line = text.split('\n').findIndex((one: string) => one.includes(EM_DASH)) + 1
        offenders.push(`${relative}:${line}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
