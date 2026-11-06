import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { inText, oldNames } from '../../../scripts/old-name'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const MOVED_PACKAGES: readonly string[] = execFileSync('git', ['ls-files', '*package.json'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .map((path) => (JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as { name?: unknown }).name)
  .filter((name): name is string => typeof name === 'string' && name.startsWith('@orden/'))
  .map((name) => name.slice('@orden/'.length))

const SAYING = ['apps/desktop/test/internal-name.test.ts', 'scripts/old-name.ts']

describe('the old name inside the repo', () => {
  test('a package moved to @orden is never written under its old name again', () => {
    const written = oldNames(SAYING)
      .filter((one) => one.kind === 'package')
      .flatMap(({ path, line, name }) => {
        const moved = MOVED_PACKAGES.find((pkg) => new RegExp(`^@nib/${pkg}(?![\\w-])`).test(name))
        return moved
          ? [`${path}:${line}: ${name} is @orden/${moved}${name.slice(5 + moved.length)} now`]
          : []
      })
    expect(written, written.join('\n')).toEqual([])
  })

  test('is told apart by what is written around it', () => {
    const text = [
      "import { readTask } from '@nib/markdown/task-line'",
      "const KEY = 'nib:ai-sidebar' // stored by nib's own window",
      'listen(\'nib://agent\'); env.NIB_MCP_TOKEN; class="nib-row"; ch.emilvinu.nib',
      'a nibble is not one, nor https://www.tiktok.com/@nib/video/1',
    ].join('\n')
    expect(inText('a.ts', text).map(({ line, kind, name }) => [line, kind, name])).toEqual([
      [1, 'package', '@nib/markdown/task-line'],
      [2, 'key', 'nib:ai-sidebar'],
      [2, 'word', 'nib'],
      [3, 'scheme', 'nib://agent'],
      [3, 'variable', 'NIB_MCP_TOKEN'],
      [3, 'dashed', 'nib-row'],
      [3, 'identifier', 'ch.emilvinu.nib'],
      [4, 'word', '@nib/video/1'],
    ])
  })
})
