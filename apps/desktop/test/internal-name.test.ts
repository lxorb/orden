import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { inText, type Kind, oldNames } from '../../../scripts/old-name'

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

const MOST: Record<Kind, number> = {
  package: 0,
  identifier: 8,
  scheme: 21,
  key: 126,
  variable: 18,
  dashed: 780,
  word: 3441,
}

const ALIASES_SHIP_IN = 'v0.21.0'

const ALIASES: Record<string, readonly string[]> = {
  'apps/cli/nib.mjs': ['NIB_'],
  'apps/desktop/public/manifest.webmanifest': ['web+nib'],
  'apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml': ['android:scheme="nib"'],
  'apps/desktop/src-tauri/src/ai_cli.rs': ['NIB_CLAUDE_CODE'],
  'apps/desktop/src-tauri/src/default_browser.rs': ['"orden", "nib"'],
  'apps/desktop/src-tauri/src/engine.rs': ['"orden", "nib"'],
  'apps/desktop/src-tauri/src/former_name.rs': ['NIB_'],
  'apps/desktop/src-tauri/src/links.rs': [
    'nib: Option',
    '"nib-chosen-icon"',
    '"nib-chosen-color"',
    '"nib-icon"',
    'Nib-Icon',
  ],
  'apps/desktop/src-tauri/src/main.rs': ['former_name'],
  'apps/desktop/src-tauri/src/reminders/link.rs': ['nib://'],
  'apps/desktop/src-tauri/src/uris.rs': ['"nib:"', 'nib://', 'NIB://'],
  'apps/desktop/src-tauri/tauri.conf.json': ['"orden", "nib"'],
  'apps/desktop/src-tauri/tauri.macos.conf.json': ['"orden", "nib"'],
  'apps/desktop/src/lib/ai/chat/tools.test.ts': ['ch.emilvinu.nib/answer'],
  'apps/desktop/src/lib/ai/chat/tools.ts': ['ch.emilvinu.nib/answer'],
  'apps/desktop/src/lib/automation/start.test.ts': ['nib://', "'nib')"],
  'apps/desktop/src/lib/automation/start.ts': ["'nib'"],
  'apps/desktop/src/lib/automation/uri.test.ts': ['nib:'],
  'apps/desktop/src/lib/automation/uri.ts': ["'nib:'", 'web+nib'],
  'apps/desktop/src/lib/canvas-rewrite.ts': ["'nib'"],
  'apps/desktop/src/lib/open-link.test.ts': ['NIB://'],
  'apps/desktop/src/lib/open-link.ts': ['|nib)'],
  'apps/desktop/src/lib/sync/aside.test.ts': ['.nib-moving-'],
  'apps/desktop/src/lib/sync/mirror.test.ts': ['.nib-moving-'],
  'apps/desktop/src/lib/sync/pass.ts': ['.nib-moving-'],
  'apps/desktop/src/lib/sync2/runner.svelte.ts': ['|nib)-moving'],
  'apps/desktop/src/lib/web-tab/address.test.ts': ['nib://'],
  'apps/desktop/src/lib/web-tab/address.ts': ["'nib:'"],
  'apps/desktop/src/lib/web-tab/own-pages.test.ts': ['nib://'],
  'apps/desktop/src/lib/web-tab/own-pages.ts': ['nib://'],
  'apps/desktop/src/lib/web-tab/shortcut-former.test.ts': ['Nib-'],
  'apps/desktop/test/android.test.ts': ['scheme="nib"'],
  'apps/desktop/test/cli-args.test.ts': ['NIB_ENDPOINT'],
  'apps/desktop/vite.config.ts': ['NIB_CLAUDE_CODE'],
  'packages/bases/src/base-former.test.ts': ['nib:'],
  'packages/bases/src/base-file.ts': ["'nib'", 'plain.nib'],
  'packages/chats/src/links.test.ts': ['nib://'],
  'packages/chats/src/links.ts': ['nib://'],
  'packages/editor/src/ai/block.test.ts': ['nib:ai'],
  'packages/editor/src/ai/block.ts': ['nib:ai'],
  'packages/editor/src/links.test.ts': ['nib://'],
  'packages/editor/src/links.ts': ['|nib)'],
  'packages/markdown/src/canvas-extras.ts': ['file.nib', "'orden', 'nib'"],

  'packages/markdown/src/canvas-former.test.ts': ['nib'],
  'packages/markdown/src/canvas.ts': ['file.nib'],
  'packages/scan/src/scan-canvas.ts': ["'nib'"],
  'packages/scan/src/shortcut.ts': ['/^nib-'],
  'scripts/account-backup.mjs': ['NIB_API', 'NIB_TOKEN'],
  'scripts/nib-sync.mjs': ['NIB_API', 'NIB_TOKEN'],
  'services/machine/nib-update': ['NIB_ORIGIN'],
  'services/machine/test/update.test.ts': ['NIB_ORIGIN'],
}

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

  test('is written no more often than it was, so each kind only goes down', () => {
    const counts = new Map<Kind, number>()
    for (const { kind } of oldNames(SAYING)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
    const over = Object.entries(MOST).flatMap(([kind, most]) => {
      const now = counts.get(kind as Kind) ?? 0
      return now > most ? [`${kind}: ${now} written, at most ${most}`] : []
    })
    expect(over, over.join('\n')).toEqual([])
  })

  test(`keeps its aliases for one release: gone once ${ALIASES_SHIP_IN} is tagged`, () => {
    const missing = Object.keys(ALIASES).filter((path) => !existsSync(join(ROOT, path)))
    expect(missing, `${missing.join(', ')} moved: name them anew`).toEqual([])
    const shipped = execFileSync('git', ['tag', '--list', ALIASES_SHIP_IN], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    const left = shipped
      ? Object.entries(ALIASES).flatMap(([path, needles]) => {
          const text = readFileSync(join(ROOT, path), 'utf8')
          return needles.filter((needle) => text.includes(needle)).map((one) => `${path}: ${one}`)
        })
      : []
    expect(left, left.join('\n')).toEqual([])
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
