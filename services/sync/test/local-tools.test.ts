import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CHAT_TOOLS } from '../src/mcp/chats'
import { TASK_TOOLS } from '../src/mcp/tasks'
import { TOOLS as NOTE_TOOLS } from '../src/mcp/tools'

const TOOLS = [...NOTE_TOOLS, ...TASK_TOOLS, ...CHAT_TOOLS]

interface Schema {
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
}

interface Tool {
  name: string
  inputSchema: Schema
}

const LOCAL = fileURLToPath(
  new URL('../../../apps/desktop/src-tauri/src/mcp/tools.json', import.meta.url),
)

const local = JSON.parse(readFileSync(LOCAL, 'utf8')) as Tool[]

describe('the local server beside the connector', () => {
  test.each(TOOLS.map((tool) => [tool.name, tool as Tool] as const))(
    '%s is there under the same name, taking what it takes',
    (name, connector) => {
      const mine = local.find((tool) => tool.name === name)
      expect(mine, `orden mcp has no ${name}`).toBeDefined()
      if (!mine) return

      const theirs = connector.inputSchema.properties ?? {}
      const ours = mine.inputSchema.properties ?? {}
      for (const [argument, schema] of Object.entries(theirs)) {
        expect(ours[argument], `${name} takes no ${argument}`).toBeDefined()
        expect(ours[argument]?.type, `${name}.${argument}`).toBe(schema.type)
      }

      const needed = new Set(connector.inputSchema.required ?? [])
      for (const argument of mine.inputSchema.required ?? []) {
        expect(
          needed.has(argument),
          `${name} needs ${argument}, which the connector does not`,
        ).toBe(true)
      }
    },
  )

  test('the sixteen are every name the two share', () => {
    const theirs = new Set(TOOLS.map((tool) => tool.name))
    const shared = local.filter((tool) => theirs.has(tool.name)).map((tool) => tool.name)

    expect(shared.sort()).toEqual([...theirs].sort())
    expect(shared).toHaveLength(16)
  })
})
