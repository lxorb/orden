import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** An agent at work never takes the reader's screen (#1070): no tab switched to, nothing
 *  jumped to, no focus, selection or scroll moved. Every verb that opens, makes, shows
 *  or moves to something comes through one door, agents/workspace/reader-view.ts, which
 *  lands it behind and marks it; this holds the rest of the folder to that, so a new
 *  tool cannot reach past it. tabs.test.ts and workspace.test.ts run the verbs. */

const DIR = fileURLToPath(new URL('../src/lib/agents/workspace', import.meta.url))
const DOOR = 'reader-view.ts'

/** What changes the reader's screen, keyboard or scroll, called directly. */
const TAKES = [
  /workspace\.activate\(/,
  /\.activeTabId\s*=[^=]/,
  /panes\.(focus|activate)\(/,
  /workspace\.(openPage|openEntry|openUnsaved|showSpace|openGraph|split|showTab)\(/,
  /settings\.show\(/,
  /scratchpad\.show\(/,
  /scrollIntoView/,
  /\.focus\(\)/,
  /import\('\.\.\/\.\.\/terminal\/open'\)/,
  /import\('\.\.\/\.\.\/online\/open'\)/,
  /import\('\.\.\/\.\.\/chats\/view\/open'\)/,
]

const sources = readdirSync(DIR).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== DOOR,
)

describe('an agent at work, in the background', () => {
  test('the agents’ verbs are all here to be read', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  test('no verb changes the reader’s screen but through the one door', () => {
    for (const name of sources) {
      const text = readFileSync(join(DIR, name), 'utf8')
      for (const take of TAKES) expect(text, `${name}: ${String(take)}`).not.toMatch(take)
    }
  })

  test('the door lands everything behind unless the front was asked for', () => {
    const door = readFileSync(join(DIR, DOOR), 'utf8')
    expect(door).toMatch(/'background' in call\.args && !flag\(call, 'background'\)/)
    expect(door).toMatch(/needScope\(call, 'workspace\.focus'/)
    expect(door).toMatch(/agentMarks\.opened/)
  })

  test('a tab an agent shows of itself lands behind; only the reader’s press brings it forward', () => {
    const activity = readFileSync(
      fileURLToPath(new URL('../src/lib/agents/ui/activity.svelte.ts', import.meta.url)),
      'utf8',
    )
    expect(activity).toMatch(/void this\.show\(said\.tab, false\)/)
    expect(activity).toMatch(/front \? 'front' : 'behind'/)
  })
})
