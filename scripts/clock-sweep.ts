import { spawnSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SHIFT = fileURLToPath(new URL('shifted-clock.mjs', import.meta.url))

const LEANS_ON_THE_CLOCK =
  /Date\.now\(|new Date\(|useFakeTimers\(|getDate\(|getDay\(|getHours\(|today|Today|tomorrow|yesterday|week|Week|month|Month|\bdue\b|\b1[6-9]\d{8}(\d{3})?\b|\b1_[6-9]\d{2}_\d{3}_\d{3}\b/

const today = new Date().toISOString().slice(0, 10)

const CLOCKS = [
  { zone: 'UTC', at: `${today}T00:05:00Z` },
  { zone: 'America/New_York', at: '2026-11-01T03:55:00Z' },
]

const projects = ['apps/desktop', ...globSync('packages/*/', { cwd: ROOT })]

let failed = 0
for (const project of projects) {
  const cwd = `${ROOT}${project}`
  const files = globSync('{src,test}/**/*.test.ts', { cwd }).filter((file) =>
    LEANS_ON_THE_CLOCK.test(readFileSync(`${cwd}/${file}`, 'utf8')),
  )
  if (files.length === 0) continue
  for (const clock of CLOCKS) {
    console.log(`\n${project}: ${files.length} files at ${clock.at} in ${clock.zone}`)
    const run = spawnSync('pnpm', ['test', ...files], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        TZ: clock.zone,
        ORDEN_TEST_CLOCK: clock.at,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${SHIFT}`.trim(),
      },
    })
    if (run.status !== 0) {
      failed++
      console.error(`${project} fails at ${clock.at} in ${clock.zone}: pin its clock`)
    }
  }
}
process.exit(failed ? 1 : 0)
