import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUDGETS = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'desktop', 'phone-budgets.json')
const shown = (value) => value.toLocaleString('en-US')
export function judge(budgets, app, measured) {
  return Object.entries(measured).map(([gate, value]) => {
    const budget = budgets[app]?.[gate]
    if (!budget || !Number.isFinite(value)) return { gate, value, passed: false, said: `${gate} ${value}: no budget` }
    const floor = 'least' in budget
    const bound = floor ? budget.least : budget.most
    const passed = floor ? value >= bound : value <= bound
    const reached = floor ? value >= budget.target : value <= budget.target
    const said = `${gate} ${shown(value)}, ${floor ? 'at least' : 'at most'} ${shown(bound)} allowed, target ${shown(budget.target)}${reached ? '' : ' not reached'}`
    return { gate, value, passed, reached, said }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [app, ...rest] = process.argv.slice(2)
  const measured = {}
  for (const one of rest) {
    if (one.startsWith('--from=')) Object.assign(measured, JSON.parse(readFileSync(one.slice(7), 'utf8')))
    else measured[one.split('=')[0]] = Number(one.split('=')[1])
  }
  if (!app || !Object.keys(measured).length) {
    console.error('usage: node scripts/phone-budget.mjs <app> (<gate>=<number> | --from=<gates.json>)...')
    process.exit(2)
  }
  const rows = judge(JSON.parse(readFileSync(BUDGETS, 'utf8')), app, measured)
  for (const row of rows) console.log(`${row.passed ? 'ok' : 'OVER'} ${app} ${row.said}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = rows.map((row) => `| ${app} | ${row.passed ? 'ok' : 'over'} | ${row.said} |`)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| app | | gate |\n|---|---|---|\n${lines.join('\n')}\n`)
  }
  process.exit(rows.every((row) => row.passed) ? 0 : 1)
}
