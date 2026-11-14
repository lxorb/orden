import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { mcpLine } from './mcp'
import { AGENT_WINDOW_VERBS, BROWSER_VERBS } from './verbs'

describe('the line that adds Orden to a client', () => {
  it('names the installed exe in quotes on Windows, at user scope', () => {
    expect(mcpLine('C:\\Users\\me\\AppData\\Local\\Orden\\orden.exe')).toBe(
      'claude mcp add --scope user orden -- "C:\\Users\\me\\AppData\\Local\\Orden\\orden.exe" mcp',
    )
    expect(mcpLine('C:\\Program Files\\Orden\\orden.exe', 'codex')).toBe(
      'codex mcp add orden -- "C:\\Program Files\\Orden\\orden.exe" mcp',
    )
  })

  it('quotes a path elsewhere only when the shell would split it', () => {
    expect(mcpLine('/usr/bin/orden')).toBe(
      'claude mcp add --scope user orden -- /usr/bin/orden mcp',
    )
    expect(mcpLine('/Applications/Orden.app/Contents/MacOS/orden', 'codex')).toBe(
      'codex mcp add orden -- /Applications/Orden.app/Contents/MacOS/orden mcp',
    )
    expect(mcpLine("/home/a/Apps/Emil's Orden.AppImage")).toBe(
      "claude mcp add --scope user orden -- '/home/a/Apps/Emil'\\''s Orden.AppImage' mcp",
    )
  })

  it('is an entry for a client configured by file', () => {
    expect(JSON.parse(mcpLine('C:\\Orden\\orden.exe', 'json'))).toEqual({
      mcpServers: { orden: { command: 'C:\\Orden\\orden.exe', args: ['mcp'] } },
    })
  })
})

describe("the MCP server's tools", () => {
  const table = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../src-tauri/src/mcp/tools.json', import.meta.url)),
      'utf8',
    ),
  ) as { name: string }[]

  it('are every verb an agent may call, and nothing else', () => {
    const own = new Set(['agent_pair', 'agent_bye'])
    const verbs = [
      ...BROWSER_VERBS.filter((verb) => !own.has(verb)),
      ...Object.keys(AGENT_WINDOW_VERBS),
    ]

    expect(table.map((tool) => tool.name).sort()).toEqual(verbs.sort())
  })
})
