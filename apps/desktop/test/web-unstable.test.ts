import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** #1112: web-unstable.yml deploys the edge beside the main that is live, which it reads
 *  off the live Worker's version message. The live version had been made by a secret
 *  change, which carries no message, and every push said so in a notice, deployed nothing
 *  and stayed green for a week. Its "Which main is live" step is run here as GitHub runs
 *  it, against a `wrangler` that answers from the deployments given. */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/web-unstable.yml'), 'utf8')

/** The step's script: the block under its `run: |`, out of its indentation. */
function script(id: string): string {
  const lines = WORKFLOW.split('\n')
  const at = lines.findIndex((line) => line.trim() === `id: ${id}`)
  const run = lines.findIndex((line, index) => index > at && line.trim() === 'run: |')
  const indent = /^ */.exec(lines[run] ?? '')?.[0].length ?? 0
  const body: string[] = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && (/^ */.exec(line)?.[0].length ?? 0) <= indent) break
    body.push(line.slice(indent + 2))
  }
  return body.join('\n')
}

interface Version {
  id: string
  annotations: Record<string, string>
}

const MAIN = 'd6bbe05c414b22b79b8ec3d84ec4fb428be3cda1'
const upload = (id: string, main = MAIN): Version => ({
  id,
  annotations: {
    'workers/message': `main ${main} unstable def5f666da50`,
    'workers/triggered_by': 'upload',
  },
})
const secret = (id: string): Version => ({ id, annotations: { 'workers/triggered_by': 'secret' } })
const bare = (id: string): Version => ({ id, annotations: { 'workers/triggered_by': 'upload' } })

const jq = spawnSync('jq', ['--version']).status === 0

/** The step run over deployments, oldest first, each all of its traffic on one version. */
function live(versions: Version[]): { status: number | null; out: string; main: string } {
  const dir = mkdtempSync(join(tmpdir(), 'web-unstable-'))
  const deployments = versions.map((one, index) => ({
    created_on: `2026-10-${String(10 + index).padStart(2, '0')}T00:00:00Z`,
    versions: [{ version_id: one.id, percentage: 100 }],
  }))
  writeFileSync(join(dir, 'deployments.json'), JSON.stringify(deployments))
  for (const one of versions) writeFileSync(join(dir, `${one.id}.json`), JSON.stringify(one))
  // `pnpm exec wrangler deployments list --json` and `... versions view <id> --json`.
  writeFileSync(
    join(dir, 'pnpm'),
    `#!/usr/bin/env bash
case "$3 $4" in
  "deployments list") cat "${dir}/deployments.json" ;;
  "versions view") cat "${dir}/$5.json" ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`,
  )
  chmodSync(join(dir, 'pnpm'), 0o755)
  const output = join(dir, 'output')
  writeFileSync(output, '')
  const run = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script('live')],
    {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    },
  )
  const main = /^main=(\S*)/m.exec(readFileSync(output, 'utf8'))?.[1] ?? ''
  return { status: run.status, out: `${run.stdout}${run.stderr}`, main }
}

describe.skipIf(!jq)('which main is live, for the edge to deploy beside', () => {
  test('is the one the live version names', () => {
    const other = 'a'.repeat(40)
    expect(live([upload('one', other), upload('two')])).toMatchObject({ status: 0, main: MAIN })
  })

  test('is found back through versions that only changed a secret', () => {
    const result = live([upload('one'), secret('two'), secret('three')])
    expect(result).toMatchObject({ status: 0, main: MAIN })
  })

  test('not known is red, never a green run that deployed nothing', () => {
    const result = live([upload('one'), bare('two'), secret('three')])
    expect(result.status).toBe(1)
    expect(result.main).toBe('')
    expect(result.out).toContain('::error::')
  })

  test('with no version that says it is red too', () => {
    expect(live([secret('one')]).status).toBe(1)
  })
})

/** The class: a step here that finds nothing to deploy beside does not end the run with a
 *  notice and a success. */
test('web-unstable.yml has no notice that says nothing was deployed', () => {
  expect(WORKFLOW).not.toMatch(/::notice::[^\n]*[Nn]othing deployed/)
})
