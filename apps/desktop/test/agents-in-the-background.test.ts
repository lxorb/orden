import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { walk } from './files'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))
const KIT = /from '[./]*agent-verbs\/src\/api'/
const DOORS: Record<string, RegExp[]> = {
  'agent-verbs/src/front.ts': [/agentMarks\.opened/],
  'agent-verbs/src/view.ts': [/readerActs === acts && moved\(before, viewNow\(\)\)/, /await putBack\(before\)/],
  'agent-host/src/reader-view.ts': [/readersView\(call/, /openPage\(url, 'behind'\)/, /activate: false, beside: true/],
  'terminal/src/agent/verbs.ts': [/activate: false/, /openedBy\(call, tab, false\)/],
  'terminal/src/agent/online.ts': [/madeOnline\(workspace\.activeTabId, false\)/],
}
const TAKES = [
  /workspace\.activate\(/,
  /\.activeTabId\s*=[^=]/,
  /panes\.(focus|activate)\(/,
  /workspace\.(openPage|openEntry|openUnsaved|showSpace|openGraph|split|showTab)\(/,
  /settings\.show\(/,
  /scratchpad\.show\(/,
  /scrollIntoView/,
  /\.focus\(\)/,
  /\bopenTerminal\(/,
  /\bmadeOnline\(/,
  /\bopenChat\((?![^)]*activate: false)/,
]
const named = (path: string) => relative(LIB, path).split(sep).join('/')
const sources = walk(LIB, (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'), ['node_modules']).filter(
  (path) => {
    const name = named(path)
    if (name in DOORS) return false
    return name.startsWith('agent-host/') || name.startsWith('agent-verbs/') || KIT.test(readFileSync(path, 'utf8'))
  },
)
describe('an agent at work, in the background', () => {
  test('the agents’ verbs are all here to be read', () => {
    expect(sources.length).toBeGreaterThan(20)
  })
  test('no verb changes the reader’s screen but through the one door', () => {
    for (const path of sources) {
      const text = readFileSync(path, 'utf8')
      for (const take of TAKES) expect(text, `${named(path)}: ${String(take)}`).not.toMatch(take)
    }
  })
  test('the doors land everything behind, put back what moved, and leave what would show something to the reader', () => {
    for (const [name, marks] of Object.entries(DOORS)) {
      const door = readFileSync(join(LIB, name), 'utf8')
      for (const mark of marks) expect(door, `${name}: ${String(mark)}`).toMatch(mark)
    }
  })
  test('a tab an agent shows of itself lands behind; only the reader’s press brings it forward', () => {
    const activity = readFileSync(join(import.meta.dirname, '../src/lib/agents/src/ui/activity.svelte.ts'), 'utf8')
    expect(activity).toMatch(/void this\.show\(said\.tab, false\)/)
    expect(activity).toMatch(/front \? 'front' : 'behind'/)
  })
})
